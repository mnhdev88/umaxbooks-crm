import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTwilioRequest, clientIdentityForUser, userIdForDialLeg } from '@/lib/voice/twilio'
import { readBusinessHours, isOpenNow } from '@/lib/business-hours'

/**
 * POST /api/voice/twilio/incoming — a lead is calling one of our pool numbers back.
 *
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts. Point every
 * caller_numbers row's Voice webhook at this URL in the Twilio console.
 *
 * Routing runs as a chain of TwiML documents, each one the ?stage= of the previous
 * <Dial action>. Twilio calls back with DialCallStatus telling us whether that leg
 * was answered, so each stage either finishes the call or escalates:
 *
 *   stage=owner (entry) — resolve the lead, log the call, ring the agent who last
 *                         called this number (they hold the context).
 *   stage=hunt          — owner didn't pick up: ring every other sales agent and
 *                         manager simultaneously.
 *   stage=voicemail     — nobody picked up: record a message and notify the owner.
 *
 * Recording + transcription reuse the existing /status webhook, so an inbound call
 * lands in voice_calls exactly like an outbound one.
 */

const OWNER_TIMEOUT = 15 // seconds to ring the owning agent alone
const HUNT_TIMEOUT = 20 // seconds to ring everyone else
const VOICEMAIL_MAX = 120 // seconds of message we'll accept

/**
 * Roles that should be rung on a callback. Admins are excluded — 7 of them, mostly
 * non-calling. 'agent' is the legacy spelling of 'sales_agent' and still in use on
 * older profiles, so both ring; developers and client accounts never do.
 */
const HUNT_ROLES = ['agent', 'sales_agent', 'sales_manager']

export async function POST(req: NextRequest) {
  // Shared-secret check, mirroring /status. Signature verification below is the real
  // guard, but verifyTwilioRequest deliberately passes when TWILIO_AUTH_TOKEN is
  // unset (a dev convenience), so this stays the backstop. The Voice webhook URL
  // configured on each number must therefore carry ?secret=…
  const expected = process.env.TWILIO_WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    console.warn('[voice/twilio/incoming] rejected: missing or wrong ?secret= on the webhook URL')
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const signature = req.headers.get('x-twilio-signature')
  // Twilio signs the exact URL it called, query string included.
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`
  if (!verifyTwilioRequest(signature, verifyUrl, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const stage = req.nextUrl.searchParams.get('stage') || 'owner'
  const from = (params.From || '').trim() // the lead
  const to = (params.To || '').trim() // our pool number
  const callSid = params.CallSid || ''

  const VoiceResponse = twilio.twiml.VoiceResponse
  const twiml = new VoiceResponse()
  const supabase = createServiceClient()

  // ── Stage 1: entry. Identify the caller and ring whoever owns them. ────────
  if (stage === 'owner') {
    // All three reads are independent and the caller is on the line — run together.
    const [{ leadId, leadName, ownerUserId }, lineName, hours] = await Promise.all([
      identifyCaller(supabase, from),
      lineNameFor(supabase, to),
      readBusinessHours(supabase),
    ])

    // Log the inbound call up front so an abandoned call (hung up while ringing)
    // is still recorded — the status webhook only fires for legs that were dialed.
    const { error: logError } = await supabase.from('voice_calls').upsert(
      {
        provider: 'twilio',
        call_id: callSid,
        lead_id: leadId,
        direction: 'inbound',
        from_number: from,
        to_number: to,
        agent_user_id: ownerUserId,
        inbound_outcome: 'abandoned', // overwritten as soon as a leg is answered
      },
      { onConflict: 'call_id', ignoreDuplicates: false }
    )
    // Logged, not thrown: the caller is on the line and routing matters more than
    // the record. If this failed, markOutcome's later UPDATE will no-op — hence the
    // explicit error line to make that traceable.
    if (logError) console.error('[voice/twilio/incoming] could not log inbound call', callSid, logError)

    // Outside working hours nobody is at a desk, so ringing the owner for 15s and
    // then the whole team for 20s just burns 35 seconds of the caller's patience
    // before the beep — most hang up first, leaving an 'abandoned' row and no way to
    // call back. Skip straight to the recorder with a greeting that says we're shut.
    const open = isOpenNow(hours, new Date())
    console.log('[voice/twilio/incoming]', { callSid, from, to, leadId, ownerUserId, open })

    if (!open) {
      recordVoicemail(twiml, {
        leadId,
        owner: ownerUserId,
        greeting: `Thanks for calling ${lineName || 'us'}. Our office is closed at the moment. Please leave a message after the tone and we will call you back on the next working day.`,
        closed: true,
      })
      return xml(twiml)
    }

    if (ownerUserId) {
      const dial = twiml.dial({
        timeout: OWNER_TIMEOUT,
        answerOnBridge: true,
        record: 'record-from-answer-dual',
        recordingStatusCallback: cb('status', { kind: 'recording', leadId }),
        recordingStatusCallbackEvent: ['completed'],
        action: next('hunt', { leadId, owner: ownerUserId }),
        method: 'POST',
      })
      addClient(dial, clientIdentityForUser(ownerUserId), leadId, leadName, { name: lineName, to })
      return xml(twiml)
    }

    // Nobody owns this caller (unknown number, or the owner has left) — go wide.
    return huntTwiml(twiml, supabase, { leadId, leadName, lineName, to, excludeUserId: null })
  }

  // ── Stage 2: the owner didn't answer. Ring everyone else. ──────────────────
  if (stage === 'hunt') {
    const leadId = req.nextUrl.searchParams.get('leadId') || null
    const owner = req.nextUrl.searchParams.get('owner') || null

    if (params.DialCallStatus === 'completed') {
      // The owner took it. Nothing left to do; the empty response ends the call.
      await markOutcome(supabase, callSid, 'answered-owner', owner)
      return xml(twiml)
    }

    const [leadName, lineName] = await Promise.all([
      leadNameFor(supabase, leadId),
      lineNameFor(supabase, to),
    ])
    return huntTwiml(twiml, supabase, { leadId, leadName, lineName, to, excludeUserId: owner })
  }

  // ── Stage 3: nobody answered. Take a message. ─────────────────────────────
  if (stage === 'voicemail') {
    const leadId = req.nextUrl.searchParams.get('leadId') || null
    const owner = req.nextUrl.searchParams.get('owner') || null

    if (params.DialCallStatus === 'completed') {
      // Someone in the hunt group took it — but which one? We rang them all at once, so
      // the answerer is only recoverable from the leg that connected. Passing null here
      // left agent_user_id as the owner who had just failed to pick up, and the call then
      // showed as handled by them on the lead's timeline.
      await markOutcome(supabase, callSid, 'answered-hunt', await userIdForDialLeg(params.DialCallSid))
      return xml(twiml)
    }

    // 'closed' is set by the entry stage when we skipped ringing entirely, so the
    // caller hears "we're closed" rather than "nobody is available" — the latter
    // sounds like the team ignored them.
    const closed = req.nextUrl.searchParams.get('closed') === '1'
    recordVoicemail(twiml, {
      leadId,
      owner,
      greeting: closed
        ? `Thanks for calling ${await lineNameFor(supabase, to) || 'us'}. Our office is closed at the moment. Please leave a message after the tone and we will call you back on the next working day.`
        : 'Sorry, no one is available to take your call right now. Please leave a message after the tone and we will call you straight back.',
      closed,
    })
    return xml(twiml)
  }

  // ── Stage 4: message left. Mark it and notify the owner. ──────────────────
  if (stage === 'voicemail-done') {
    const leadId = req.nextUrl.searchParams.get('leadId') || null
    const owner = req.nextUrl.searchParams.get('owner') || null
    const closed = req.nextUrl.searchParams.get('closed') === '1'

    // RecordingDuration is absent/0 when the caller hung up at the beep — that's not
    // a voicemail, and marking it as one would leave an agent chasing silence.
    const left = Number(params.RecordingDuration || '0') > 0
    const base = left ? 'voicemail' : 'abandoned'

    await markOutcome(supabase, callSid, closed ? `${base}-closed` : base, owner)
    if (left) {
      await notifyMissed(supabase, { leadId, owner, from, voicemail: true, closed })
    }

    twiml.say({ voice: 'Polly.Joanna' }, 'Thanks. We will be in touch shortly. Goodbye.')
    twiml.hangup()
    return xml(twiml)
  }

  return xml(twiml)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Absolute URL back into this route at the given stage, carrying context forward. */
function next(stage: string, ctx: Record<string, string | null>): string {
  const u = new URL(`${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twilio/incoming`)
  const secret = process.env.TWILIO_WEBHOOK_SECRET || ''
  if (secret) u.searchParams.set('secret', secret)
  u.searchParams.set('stage', stage)
  for (const [k, v] of Object.entries(ctx)) if (v) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * Absolute URL to a sibling voice webhook (we reuse /status for recordings).
 *
 * direction=inbound is stamped here, not by callers: every callback originating from
 * this route belongs to an inbound call, and /status defaults to 'outbound' when the
 * param is absent. Setting it per-call-site meant one missed spot silently flipped a
 * finished inbound call to outbound, which then counted against a caller number's
 * daily cap and showed up in the dialer report as an agent's outbound call.
 */
function cb(route: string, ctx: Record<string, string | null>): string {
  const u = new URL(`${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twilio/${route}`)
  const secret = process.env.TWILIO_WEBHOOK_SECRET || ''
  if (secret) u.searchParams.set('secret', secret)
  u.searchParams.set('direction', 'inbound')
  for (const [k, v] of Object.entries(ctx)) if (v) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * Add a <Client> to a <Dial>, passing lead context as custom parameters so the
 * browser can show who's calling before the agent answers.
 *
 * lineName is which of our business lines was dialed — the agent needs it to pick a
 * greeting, and it has to arrive before they answer, so it rides along here rather
 * than being fetched by the browser.
 */
function addClient(
  dial: ReturnType<twilio.twiml.VoiceResponse['dial']>,
  identity: string,
  leadId: string | null,
  leadName: string | null,
  line: { name: string | null; to: string }
) {
  const client = dial.client()
  client.identity(identity)
  if (leadId) client.parameter({ name: 'leadId', value: leadId })
  if (leadName) client.parameter({ name: 'leadName', value: leadName })
  if (line.name) client.parameter({ name: 'lineName', value: line.name })
  // On the browser's leg, `To` is the client identity — the dialed number isn't
  // otherwise recoverable, so send it for the unlabelled-line fallback.
  if (line.to) client.parameter({ name: 'toPhone', value: line.to })
}

/**
 * Speak a greeting and record a message. Shared by the after-hours path (which skips
 * ringing entirely) and the rang-out path, so both produce an identical recording +
 * transcription + notification chain.
 */
function recordVoicemail(
  twiml: twilio.twiml.VoiceResponse,
  opts: { leadId: string | null; owner: string | null; greeting: string; closed: boolean }
) {
  twiml.say({ voice: 'Polly.Joanna' }, opts.greeting)
  twiml.record({
    maxLength: VOICEMAIL_MAX,
    playBeep: true,
    trim: 'trim-silence',
    recordingStatusCallback: cb('status', { kind: 'recording', leadId: opts.leadId }),
    recordingStatusCallbackEvent: ['completed'],
    action: next('voicemail-done', {
      leadId: opts.leadId,
      owner: opts.owner,
      closed: opts.closed ? '1' : null,
    }),
    method: 'POST',
  })
  // Reached only if the caller hangs up without recording.
  twiml.hangup()
}

/**
 * Friendly name for one of our numbers, from caller_numbers.label (097).
 *
 * Looked up per stage rather than threaded through the ?stage= chain: `To` is present
 * on every Twilio callback, so a fresh read is one indexed lookup and can't drift out
 * of sync with the query string. Returns null for an unlabelled or unknown number and
 * the popup falls back to the number itself.
 */
async function lineNameFor(
  supabase: ReturnType<typeof createServiceClient>,
  to: string
): Promise<string | null> {
  if (!to) return null
  const { data } = await supabase
    .from('caller_numbers')
    .select('label')
    .eq('phone_number', to)
    .maybeSingle()
  return data?.label ?? null
}

/**
 * Resolve an inbound caller to a lead and the agent who should get the call: the
 * one who most recently dialed this number, falling back to the lead's assigned
 * agent. Matching the actual caller beats the assignment — whoever just spoke to
 * them has the context, even if the lead is assigned elsewhere.
 */
async function identifyCaller(
  supabase: ReturnType<typeof createServiceClient>,
  from: string
): Promise<{ leadId: string | null; leadName: string | null; ownerUserId: string | null }> {
  if (!from) return { leadId: null, leadName: null, ownerUserId: null }

  const { data: leadId } = await supabase.rpc('lead_id_for_phone', { p_phone: from })
  if (!leadId) return { leadId: null, leadName: null, ownerUserId: null }

  const { data: lead } = await supabase
    .from('leads')
    .select('name, assigned_agent_id')
    .eq('id', leadId)
    .single()

  // Most recent outbound call TO this lead that we know the agent for.
  const { data: lastCall } = await supabase
    .from('voice_calls')
    .select('agent_user_id')
    .eq('lead_id', leadId)
    .eq('direction', 'outbound')
    .not('agent_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    leadId: leadId as string,
    leadName: lead?.name ?? null,
    ownerUserId: lastCall?.agent_user_id ?? lead?.assigned_agent_id ?? null,
  }
}

async function leadNameFor(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string | null
): Promise<string | null> {
  if (!leadId) return null
  const { data } = await supabase.from('leads').select('name').eq('id', leadId).single()
  return data?.name ?? null
}

/**
 * Ring every sales agent/manager at once (minus whoever already had their turn).
 * If there's nobody to ring we fall straight through to voicemail rather than
 * returning an empty document, which would drop the call silently.
 */
async function huntTwiml(
  twiml: twilio.twiml.VoiceResponse,
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    leadId: string | null
    leadName: string | null
    lineName: string | null
    to: string
    excludeUserId: string | null
  }
): Promise<NextResponse> {
  const { data: staff } = await supabase.from('profiles').select('id').in('role', HUNT_ROLES)

  const ids = (staff || [])
    .map((s: { id: string }) => s.id)
    .filter((id) => id !== opts.excludeUserId)

  if (ids.length === 0) {
    twiml.redirect(next('voicemail', { leadId: opts.leadId, owner: opts.excludeUserId }))
    return xml(twiml)
  }

  const dial = twiml.dial({
    timeout: HUNT_TIMEOUT,
    answerOnBridge: true,
    record: 'record-from-answer-dual',
    recordingStatusCallback: cb('status', { kind: 'recording', leadId: opts.leadId }),
    recordingStatusCallbackEvent: ['completed'],
    action: next('voicemail', { leadId: opts.leadId, owner: opts.excludeUserId }),
    method: 'POST',
  })
  // Multiple <Client> nouns in one <Dial> ring simultaneously; first to answer wins.
  for (const id of ids) {
    addClient(dial, clientIdentityForUser(id), opts.leadId, opts.leadName, {
      name: opts.lineName,
      to: opts.to,
    })
  }

  return xml(twiml)
}

/**
 * Timeline wording per outcome. The two 'answered' entries are only a fallback — when we
 * can resolve the agent we name them instead, since "the team" tells whoever reads the
 * timeline next nothing about who to ask about the call.
 */
const OUTCOME_LABEL: Record<string, string> = {
  'answered-owner': 'Answered by the agent who last called them.',
  'answered-hunt': 'Answered by the team.',
  voicemail: 'Nobody answered — the caller left a voicemail.',
  abandoned: 'Nobody answered — the caller hung up before voicemail.',
  'voicemail-closed': 'Called outside working hours and left a voicemail.',
  'abandoned-closed': 'Called outside working hours and hung up without leaving a message.',
}

/**
 * Record how the inbound call ended, and drop it on the lead's timeline so a
 * callback is as visible as an outbound attempt. Best-effort throughout — a
 * storage failure must never break the call that's still in progress.
 */
async function markOutcome(
  supabase: ReturnType<typeof createServiceClient>,
  callSid: string,
  outcome: string,
  agentUserId: string | null
) {
  if (!callSid) return

  const patch: Record<string, unknown> = { inbound_outcome: outcome }
  if (agentUserId) patch.agent_user_id = agentUserId

  const { data, error } = await supabase
    .from('voice_calls')
    .update(patch)
    .eq('call_id', callSid)
    .select('lead_id, agent_user_id')
    .maybeSingle()

  if (error) {
    console.error('[voice/twilio/incoming] markOutcome failed', callSid, error)
    return
  }
  if (!data?.lead_id) return

  const handledBy = agentUserId ?? data.agent_user_id ?? null
  const answerer = outcome.startsWith('answered') ? await agentNameFor(supabase, handledBy) : null

  await supabase.from('leads').update({ last_call_at: new Date().toISOString() }).eq('id', data.lead_id)

  await supabase.from('activity_logs').insert({
    lead_id: data.lead_id,
    user_id: handledBy,
    action: 'Inbound Call',
    details: `Lead called back. ${answerer ? `Answered by ${answerer}.` : (OUTCOME_LABEL[outcome] ?? outcome)}`,
  })
}

/** Display name for a staff member, for timeline copy. Null when unknown. */
async function agentNameFor(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name ?? null
}

/**
 * Tell the owning agent they missed a callback. Notifications feed the bell and,
 * via the pg_net trigger from 058, a web push.
 */
async function notifyMissed(
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    leadId: string | null
    owner: string | null
    from: string
    voicemail: boolean
    closed?: boolean
  }
) {
  const name = await leadNameFor(supabase, opts.leadId)
  const who = name || opts.from || 'An unknown number'

  // Normally only the owning agent is told. But an after-hours voicemail often has no
  // owner at all (a brand-new caller at 10pm), and a message nobody is notified about
  // is a lost lead — so fall back to the whole hunt group rather than dropping it.
  let recipients: string[] = opts.owner ? [opts.owner] : []
  if (!recipients.length && opts.voicemail) {
    const { data: staff } = await supabase.from('profiles').select('id').in('role', HUNT_ROLES)
    recipients = (staff || []).map((s: { id: string }) => s.id)
  }
  if (!recipients.length) return

  const message = opts.voicemail
    ? opts.closed
      ? `${who} called outside working hours and left a voicemail.`
      : `${who} called back and left a voicemail.`
    : `${who} called back but nobody answered.`

  const { error } = await supabase.from('notifications').insert(
    recipients.map((user_id) => ({
      user_id,
      lead_id: opts.leadId,
      title: opts.voicemail ? 'Voicemail from a lead' : 'Missed callback',
      message,
      type: 'warning',
    }))
  )
  if (error) console.error('[voice/twilio/incoming] notify failed', error)
}

function xml(twiml: { toString(): string }): NextResponse {
  return new NextResponse(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } })
}
