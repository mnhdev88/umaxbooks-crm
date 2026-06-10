import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTwilioRequest, userIdFromIdentity } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/status — Twilio call lifecycle + recording callbacks for the
 * browser dialer. The Twilio analog of /api/voice/webhook (Bland).
 *
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts. Two kinds of
 * callbacks arrive here, both keyed to the parent CallSid (set as ?kind= on the URL by
 * the /voice TwiML route):
 *   kind=dial      — fires when the dialed leg ends; carries DialCallStatus + duration.
 *   kind=recording — fires when the recording is ready; carries RecordingUrl + duration.
 *
 * Both upsert onto the same voice_calls row (unique on call_id) so they merge. We also
 * roll the latest outcome onto the lead and drop a timeline entry — best-effort, never
 * failing the webhook over our own storage.
 */
export async function POST(req: NextRequest) {
  // Shared-secret check (mirrors the Bland webhook), then Twilio signature verification.
  const expected = process.env.TWILIO_WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const signature = req.headers.get('x-twilio-signature')
  // Twilio signs over the EXACT URL it called, including our query string.
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`
  if (!verifyTwilioRequest(signature, verifyUrl, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const kind = req.nextUrl.searchParams.get('kind') || 'dial'
  const leadId = req.nextUrl.searchParams.get('leadId') || null
  const agentIdentity = req.nextUrl.searchParams.get('agent') || ''
  const agentUserId = userIdFromIdentity(agentIdentity)

  const callSid = params.CallSid || params.ParentCallSid || ''
  if (!callSid) return NextResponse.json({ ok: true })

  // Build the partial row for this callback kind. Upsert merges with the other kind.
  const row: Record<string, unknown> = {
    provider: 'twilio',
    call_id: callSid,
    lead_id: leadId,
    agent_user_id: agentUserId,
    direction: 'outbound',
  }

  if (kind === 'recording') {
    if (params.RecordingUrl) row.recording_url = params.RecordingUrl
    if (params.RecordingDuration) row.call_length_min = Number(params.RecordingDuration) / 60
  } else {
    // dial action callback
    const status = params.DialCallStatus || params.CallStatus || null
    row.status = status
    row.answered_by = status === 'completed' ? 'human' : status
    row.completed = status === 'completed'
    if (params.DialCallDuration) {
      row.duration_sec = Number(params.DialCallDuration)
      row.call_length_min = Number(params.DialCallDuration) / 60
    }
  }

  console.log('[voice/twilio/status]', { kind, callSid, leadId, agentUserId, status: row.status })

  try {
    const supabase = createServiceClient()

    await supabase
      .from('voice_calls')
      .upsert(row, { onConflict: 'call_id', ignoreDuplicates: false })

    // Roll up + timeline only on the dial callback (the one with the outcome), and only
    // when we know the lead.
    if (kind === 'dial' && leadId) {
      const status = (row.status as string) || 'unknown'
      await supabase
        .from('leads')
        .update({
          last_call_outcome: status,
          last_call_at: new Date().toISOString(),
        })
        .eq('id', leadId)

      const mins =
        typeof row.duration_sec === 'number' ? `${((row.duration_sec as number) / 60).toFixed(1)} min` : null
      const details = [
        'Live dialer call (Twilio).',
        `Outcome: ${status}.`,
        mins ? `Length: ${mins}.` : null,
      ]
        .filter(Boolean)
        .join(' ')

      await supabase.from('activity_logs').insert({
        lead_id: leadId,
        user_id: agentUserId,
        action: 'Dialer Call',
        details,
      })
    }
  } catch (e) {
    console.error('[voice/twilio/status] failed to persist', callSid, e)
  }

  return NextResponse.json({ ok: true })
}
