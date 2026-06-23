/**
 * Bland AI outbound-call helper.
 *
 * PROTOTYPE: places a single AI voice call to a phone number and (optionally)
 * tags it with a leadId so the webhook can attribute the result to a CRM lead.
 *
 * Required env:
 *   BLAND_API_KEY          – your Bland org/API key (sent raw in the `authorization` header)
 * Optional env:
 *   BLAND_VOICE            – Bland voice name (default "june")
 *   BLAND_PATHWAY_ID       – if set, uses a saved Pathway instead of the inline task
 *   VOICE_WEBHOOK_SECRET   – appended as ?secret= to the webhook URL and checked on receipt
 *   VOICE_WEBHOOK_URL      – override the webhook base (defaults to NEXT_PUBLIC_APP_URL)
 *
 * Docs: https://docs.bland.ai/api-v1/post/calls
 */

import { NOVELIO_KNOWLEDGE_BASE } from './knowledge-base'

const BLAND_BASE = 'https://api.bland.ai'

const AGENCY_NAME = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/**
 * Spell a phone number out digit-by-digit for TTS so "201" is read "two zero one",
 * not "two hundred one". Groups as area code / prefix / line ("nine zero eight,
 * two zero one, two two six four") with commas for natural pauses. Falls back to the
 * raw string if it doesn't look like a phone number.
 */
function spokenPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw
  // Drop a leading US country code so we speak the 10-digit local number.
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const groups =
    local.length === 10
      ? [local.slice(0, 3), local.slice(3, 6), local.slice(6)]
      : [local]
  return groups.map((g) => g.split('').map((d) => DIGIT_WORDS[Number(d)]).join(' ')).join(', ')
}

// Callback number the agent reads out — in voicemails and when asked for one on a live call.
// Override via env; defaults to the agency's published line.
const CALLBACK_PHONE =
  process.env.BLAND_CALLBACK_NUMBER || process.env.NEXT_PUBLIC_AGENCY_PHONE || '(908) 201-2264'
// TTS reads "(908) 201-2264" as numbers ("two hundred one"); spell it out digit-by-digit
// ("nine zero eight, two zero one, two two six four") so the voice agent reads it correctly.
const CALLBACK_PHONE_SPOKEN = spokenPhone(CALLBACK_PHONE)
// The name the AI agent introduces itself with.
const AGENT_NAME = process.env.BLAND_AGENT_NAME || 'Aria'

export interface StartCallInput {
  /** Destination phone number. Accepts US 10-digit, 1XXXXXXXXXX, or E.164. */
  phone: string
  /** Lead's name, used to personalise the opening line. */
  name?: string
  /** Lead's company / business name, used throughout the script. */
  company?: string
  /** Lead's city — drives the "[service] in [City]" personalisation. */
  city?: string
  /** Lead's business type / service (e.g. "plumber", "salon"). */
  businessType?: string
  /** The lead's existing website URL, if any. Empty/absent ⇒ "no website" opener. */
  website?: string
  /**
   * Whether a demo site has actually been pre-built for this lead. When true, the agent
   * may use the KB's "we already built you a working website" close. When false/absent,
   * the agent must NOT claim a site exists — it offers to build a free demo instead.
   */
  demoReady?: boolean
  /** Optional CRM lead id — echoed back on the webhook so we can attribute the call. */
  leadId?: string
}

/**
 * Normalise a phone number to E.164 (+1XXXXXXXXXX for US). Strips ALL formatting
 * (spaces, dots, parens, dashes) — including from numbers that already start with "+",
 * which is the common case that previously slipped through as "+1 304.556.4839" and
 * got rejected by Bland as invalid.
 */
export function toE164US(raw: string): string {
  const trimmed = (raw || '').trim()
  const intl = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (intl) return `+${digits}`                          // already international — just drop formatting
  if (digits.length === 10) return `+1${digits}`          // bare US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`                                     // best effort; validated by isValidE164()
}

/**
 * True when the value is a dialable E.164 number. Enforces NANP rules for +1 numbers
 * (exactly 11 digits; area code and exchange must start 2–9) so junk like "9090909000",
 * double numbers, UK "0…" numbers, or "+1 555 12" are rejected before we ever call Bland.
 */
export function isValidE164(e164: string): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return false      // E.164: 8–15 digits, can't start with 0
  if (e164.startsWith('+1')) return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164)
  return true
}

/** First name or a safe fallback. */
function firstNameOf(name?: string): string {
  return name?.trim().split(/\s+/)[0] || 'there'
}

/** Naive English pluralisation of the last word in a phrase ("hair salon" → "hair salons"). */
function pluralizeLastWord(phrase: string): string {
  const parts = phrase.trim().split(/\s+/)
  const last = parts[parts.length - 1]
  if (!last) return phrase
  // Already plural-ish — leave it.
  if (/(s|ses|ies)$/i.test(last)) return phrase
  let plural: string
  if (/(x|z|ch|sh)$/i.test(last)) plural = `${last}es`
  else if (/[^aeiou]y$/i.test(last)) plural = `${last.slice(0, -1)}ies`
  else plural = `${last}s`
  parts[parts.length - 1] = plural
  return parts.join(' ')
}

/** The service/business-type phrase used in the "[service] in [City]" line, pluralised. */
function serviceWord(businessType?: string): string {
  const bt = businessType?.trim()
  return bt ? pluralizeLastWord(bt) : 'businesses like yours'
}

/**
 * Opening line — pain-first per the knowledge base, branching on whether the lead
 * already has a website. The agent presents as a business growth partner and speaks
 * naturally; it does NOT volunteer that it's an AI. It discloses honestly only if the
 * prospect directly asks (handled in buildTask). NOTE: undisclosed AI voice calls carry
 * TCPA / state bot-disclosure risk — ensure your use is consented/compliant.
 */
function buildFirstSentence(input: StartCallInput): string {
  const firstName = firstNameOf(input.name)
  const city = input.city?.trim()
  const where = city ? ` in ${city}` : ' in your area'
  const service = serviceWord(input.businessType)
  const hasWebsite = !!input.website?.trim()

  if (hasWebsite) {
    // "Outdated / ranking low" opener.
    return (
      `Hi — is this ${firstName}? It's ${AGENT_NAME}, I work with ${service}${where} on getting found ` +
      `online. I was actually looking at your website earlier, comparing it to what Google's pushing ` +
      `right now, and I spotted a couple of things quietly dragging you down in the results. Honestly ` +
      `not your fault — Google moved the goalposts. You got a quick two minutes?`
    )
  }
  // "No website" opener.
  return (
    `Hi — is this ${firstName}? It's ${AGENT_NAME}, I help ${service}${where} get found online. I was ` +
    `running a quick check earlier and noticed you don't have a website yet — but a few of your ` +
    `competitors do, and they're popping up every time someone searches. I jotted down what that's ` +
    `probably costing you. Got two minutes?`
  )
}

/**
 * The conversation instructions (Bland "task"): the full knowledge base plus the
 * specific lead's context so the agent fills in [Name], [City], [service], etc.
 */
function buildTask(input: StartCallInput): string {
  const hasWebsite = !!input.website?.trim()
  const context = [
    'LEAD CONTEXT (use to personalise the knowledge-base script — never read this aloud as a list):',
    `- Prospect first name: ${firstNameOf(input.name)}`,
    input.company?.trim() ? `- Business name: ${input.company.trim()}` : '- Business name: (unknown — say "your business")',
    input.city?.trim() ? `- City: ${input.city.trim()}` : '- City: (unknown — say "your area")',
    `- Business type / service: ${serviceWord(input.businessType)}`,
    hasWebsite
      ? `- Website status: HAS a website (${input.website!.trim()}) — treat as outdated / ranking low. Use the "outdated website" opener and objections.`
      : `- Website status: NO website found — use the "no website" opener and objections.`,
    input.demoReady
      ? `- Demo status: A working demo site HAS been pre-built for this business. Fold it into the strategy-session recommendation as something concrete the specialist will walk them through — do NOT lead with it or use it as a hard close.`
      : `- Demo status: NO demo has been built yet. CRITICAL: do NOT claim a website already exists or is "sitting on our server." Diagnose, give an insight, then offer the free strategy session and a free starter/demo as the takeaway. Never imply a finished site exists.`,
  ].join('\n')

  return [
    `You are ${AGENT_NAME}, a warm, sharp business growth consultant calling for ${AGENCY_NAME}.`,
    `You are calling a US local-service business owner — peer to peer, owner to advisor.`,
    '',
    'IDENTITY & DISCLOSURE:',
    '- You are a business growth consultant. You help local business owners figure out WHY they are not getting more customers online, and what to do about it. You are NOT a "developer," "website company," "marketing agency," or "salesperson," and you are NOT here to pitch.',
    '- Speak completely naturally, like a real person on the phone. Do NOT volunteer that you are an AI, automated, or a recording.',
    `- ONLY if the prospect directly asks whether you are a bot, a robot, a recording, an AI, or "a real person," answer honestly and briefly — e.g. "I'm an AI assistant for ${AGENCY_NAME}, but everything I'm telling you is real — want me to keep going?" — then continue naturally. Never deny it when asked directly.`,
    '',
    'CONSULTANT MINDSET & INTENT (this is how you must come across on every call):',
    '- Your genuine intent is to HELP this owner grow their business — not to sell. If you help them think more clearly about their growth, the call is a success even before any offer.',
    '- DIAGNOSE BEFORE YOU PRESCRIBE. Get curious about their business first — how they get customers, what is working, where growth feels stuck. Ask, listen, and let them talk MORE than you do. Never lead with a pitch.',
    '- GIVE VALUE FIRST. Share one genuinely useful, specific observation or insight for free (what you noticed about their online presence, what their competitors are doing, one quick win) before you ever mention a plan or a price. Earn the right to advise.',
    '- Talk like a trusted advisor and equal, not a telemarketer: calm, confident, lightly consultative, occasionally thinking out loud ("what I\'d look at first is…", "the pattern I usually see with [service] owners is…").',
    '- Diagnose out loud in plain English. Frame problems as fixable and not their fault. Make them feel understood, not cornered.',
    '- The website, plan, and demo are your RECOMMENDATION that comes out of the conversation — never the thing you open with or push. Recommend, don\'t pressure.',
    '',
    context,
    '',
    'Delivery rules:',
    '- TAKE TURNS. Say at most one or two sentences, then STOP and wait for the prospect to respond. Never deliver a long monologue or stack multiple points back-to-back. After every question, stop and wait for their answer.',
    '- IF PUT ON HOLD OR ASKED TO WAIT: if the prospect says to hold on, wait, give them a second, "let me grab something", or that someone/something needs them — acknowledge ONCE, briefly ("Of course, take your time — I\'ll wait"), then STOP talking completely and stay silent. Do NOT continue the pitch, do NOT repeat yourself, do NOT fill the silence. Only speak again after they clearly come back and speak to you.',
    '- IF YOU HEAR SILENCE, HOLD MUSIC, OR BACKGROUND NOISE (not the prospect actually talking to you): stay quiet and wait. Do not treat music or noise as something to respond to, and do not keep talking into dead air.',
    '- IF YOU REACH AN AUTOMATED PHONE MENU, IVR, OR AUTO-ATTENDANT (e.g. "press 1 for sales, press 2 for support", "para español oprima…", "enter the extension", "you have reached the company directory", "your call is important to us, please stay on the line"): do NOT press any keys, do NOT try to navigate the menu, and do NOT deliver your pitch to it. Stay silent and END THE CALL immediately. This is NOT a voicemail — do not leave a message; just hang up.',
    '- Sound human: use contractions, short everyday sentences, and a relaxed conversational rhythm. Never sound like you are reading a script.',
    '- Use light, natural acknowledgements as they talk ("right," "yeah, totally," "gotcha," "mm-hmm") and the occasional brief filler — but do not overdo it.',
    '- Vary your phrasing; never repeat the same canned line twice. Mirror the prospect\'s energy — if they are brief, be brief.',
    '- Speak at a calm, measured, unhurried pace. Pause briefly after questions. Never rush or talk over them.',
    '- Use the knowledge base below as your expertise and reference — its diagnostic angles, discovery questions, objection answers, and pricing. Follow its facts exactly, but deliver them like a consultant in conversation, NOT like you are reading a script.',
    '- Diagnose before you prescribe. Lead with curiosity and a useful insight; do not pitch price unless they ask. If asked, lead with the free audit / free plan, then "monthly growth plans start at $249, website included." Never quote a big upfront cost.',
    '- Your goal is to book a free, no-obligation growth strategy session (a short consult where the human specialist walks through what you found and a tailored plan) — offer two specific time slots, never open-ended. Frame it as a working session to help them, not a sales demo.',
    '- Do not invent services, results, prices, or guarantees beyond the knowledge base. Defer deep specifics to the human specialist in the strategy session.',
    '- Answer objections like an advisor explaining, not a closer overcoming. If they ask not to be called or are genuinely not interested after one helpful reframe, respect it — thank them warmly and end politely.',
    CALLBACK_PHONE ? `- If they ask for a callback number, read it out digit by digit, slowly: ${CALLBACK_PHONE_SPOKEN}.` : '',
    '',
    '=== KNOWLEDGE BASE (your script and rules) ===',
    NOVELIO_KNOWLEDGE_BASE,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Voicemail drop — pain-first, under ~28s, per the KB (V1 no-website / V2 has-website). */
function buildVoicemail(input: StartCallInput): string {
  const firstName = firstNameOf(input.name)
  const city = input.city?.trim()
  const where = city ? ` in ${city}` : ' in your area'
  const service = serviceWord(input.businessType)
  const callback = CALLBACK_PHONE ? ` Give me a call back at ${CALLBACK_PHONE_SPOKEN}` : ' Give me a call back'
  const hasWebsite = !!input.website?.trim()
  // Only claim a built demo when one actually exists; otherwise offer to build one.
  const demoLine = input.demoReady
    ? 'I actually put together a quick demo website for your business to show you what it could look like — completely free, no obligation.'
    : "I'd love to show you, free and with no obligation, exactly what's costing you customers and what a fix would look like."

  if (hasWebsite) {
    return (
      `Hi ${firstName}, it's ${AGENT_NAME} — I work with ${service}${where} on getting found online. I ran a ` +
      `quick search and your competitor came up right away, but your business didn't show. I found a few ` +
      `specific things holding you back. ${demoLine}${callback}. Thanks ${firstName}, talk soon!`
    )
  }
  return (
    `Hi ${firstName}, it's ${AGENT_NAME} — I help ${service}${where} get found online. I was looking around ` +
    `today and noticed your business doesn't have a website yet, but your competitors do and they're showing ` +
    `up every time someone searches. ${demoLine}${callback}. Thanks, talk soon!`
  )
}

function buildWebhookUrl(): string | undefined {
  const base = process.env.VOICE_WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!base) return undefined
  const url = `${base.replace(/\/$/, '')}/api/voice/webhook`
  const secret = process.env.VOICE_WEBHOOK_SECRET
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url
}

export interface StartCallResult {
  ok: boolean
  status: number
  callId?: string
  body?: unknown
  error?: string
}

/** Place an outbound AI voice call via Bland. */
export async function startOutboundCall(input: StartCallInput): Promise<StartCallResult> {
  const apiKey = process.env.BLAND_API_KEY
  if (!apiKey) return { ok: false, status: 500, error: 'BLAND_API_KEY is not set' }

  // Normalise + validate before we ever hit Bland, so the user gets a clear message
  // instead of Bland's opaque "invalid number".
  const phoneNumber = toE164US(input.phone)
  if (!isValidE164(phoneNumber)) {
    return {
      ok: false,
      status: 422,
      error: `"${input.phone}" isn't a valid phone number we can dial. Please correct it on the lead (US numbers should be 10 digits, e.g. (325) 795-0103).`,
    }
  }

  const payload: Record<string, unknown> = {
    phone_number: phoneNumber,
    // Caller ID — the number you purchased in Bland. If unset, Bland uses a shared/random number.
    from: process.env.BLAND_FROM_NUMBER || undefined,
    voice: process.env.BLAND_VOICE || 'june',
    // How long (ms) the agent waits before responding. Higher = more patient, less
    // rushed, won't talk over the lead. Default Bland is 500; we use 800 for a calmer feel.
    interruption_threshold: Number(process.env.BLAND_INTERRUPTION_THRESHOLD) || 800,
    // Higher temperature = more natural, varied, human-sounding phrasing (less robotic/scripted).
    // 0–1; we default to 0.7 for a conversational feel. Lower it if the agent drifts off-script.
    temperature: Number(process.env.BLAND_TEMPERATURE) || 0.7,
    // Filter background noise / hold music so it isn't transcribed as phantom user speech that
    // makes the agent keep talking when the prospect has stepped away. Toggle via env if needed.
    noise_cancellation: process.env.BLAND_NOISE_CANCELLATION !== 'off',
    // MUST stay false: when the prospect comes back from hold (or wants to cut in), the agent has
    // to be interruptible. Setting this true would make the agent talk over them. Left at default.
    block_interruptions: false,
    first_sentence: buildFirstSentence(input),
    wait_for_greeting: true,
    record: true,
    max_duration: 12, // minutes — safety cap
    voicemail_action: 'leave_message',
    voicemail_message: buildVoicemail(input),
    metadata: input.leadId ? { leadId: input.leadId } : undefined,
    webhook: buildWebhookUrl(),
  }

  // Prefer a saved Pathway if configured; otherwise use the inline task.
  const pathwayId = process.env.BLAND_PATHWAY_ID
  if (pathwayId) {
    payload.pathway_id = pathwayId
    payload.request_data = {
      name: input.name,
      company: input.company,
      city: input.city,
      businessType: input.businessType,
      website: input.website,
      demoReady: input.demoReady,
    }
  } else {
    payload.task = buildTask(input)
  }

  let res: Response
  try {
    res = await fetch(`${BLAND_BASE}/v1/calls`, {
      method: 'POST',
      headers: {
        authorization: apiKey, // Bland uses the raw key, NOT "Bearer ..."
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { ok: false, status: 502, error: `Failed to reach Bland: ${(e as Error).message}` }
  }

  const body = await res.json().catch(() => null)
  const status = (body as { status?: string })?.status

  // Bland returns HTTP 200 with { status: "success" | "error", call_id, message }.
  if (!res.ok || status === 'error') {
    return {
      ok: false,
      status: res.ok ? 422 : res.status,
      body,
      error: (body as { message?: string })?.message || `Bland call failed (${res.status})`,
    }
  }

  return { ok: true, status: res.status, callId: (body as { call_id?: string })?.call_id, body }
}

// ────────────────────────────────────────────────────────────────────────────
// Post-call analysis — Bland extracts structured data from the transcript for us.
// We POST our questions to /v1/calls/{call_id}/analyze and Bland returns answers
// positionally aligned with the questions. Docs: https://docs.bland.ai/api-v1/post/analyze
// ────────────────────────────────────────────────────────────────────────────

/** Structured fields Bland pulls out of the call transcript for the CRM. */
export interface AnalyzedCallData {
  interested: 'yes' | 'no' | 'maybe' | null
  objection: string | null
  do_not_call: boolean
  appointment_booked: boolean
  appointment_time: string | null
  callback_requested: boolean
  callback_time: string | null
  has_website: boolean | null
  current_website: string | null
  budget_mentioned: string | null
  decision_maker: boolean | null
  notes: string | null
}

const ANALYSIS_GOAL =
  `An AI agent placed an outbound cold call to a US local-service business owner to point out ` +
  `website/SEO problems and book a free 15-minute demo walkthrough. Determine ONLY what the ` +
  `person who was called (the prospect) actually said or agreed to during the conversation.`

/**
 * Questions sent to Bland's analyze endpoint. ORDER IS LOAD-BEARING — `answers`
 * comes back positionally aligned, so keep this in sync with parseAnswers() below.
 */
const ANALYSIS_QUESTIONS: [string, string][] = [
  ['Did the prospect show interest in the offer? Answer only "yes", "no", or "maybe".', 'string'],
  ['What was the main objection or concern the prospect raised, if any?', 'string'],
  ['Did the prospect ask not to be called or contacted again?', 'boolean'],
  ['Did the prospect agree to a specific demo or meeting time?', 'boolean'],
  ['What demo/appointment time did the prospect agree to, if any?', 'string'],
  ['Did the prospect ask to be called back at a later time?', 'boolean'],
  ['When did the prospect want to be called back, if they said?', 'string'],
  ['Does the prospect already have a website?', 'boolean'],
  ["What is the prospect's website URL or name, if mentioned?", 'string'],
  ['What budget or price did the prospect mention, if any?', 'string'],
  ['Is the person who was called the owner or a decision maker?', 'boolean'],
  ['In one short sentence, summarise anything else notable the prospect said.', 'string'],
]

/** Bland sometimes returns "null"/"none"/"n/a" as a string for an empty answer. */
function cleanStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s || /^(null|none|n\/?a|unknown|not mentioned|not specified)$/i.test(s)) return null
  return s
}

/** Coerce Bland's answer (real boolean, or "true"/"yes" string) to a boolean. */
function toBool(v: unknown): boolean {
  if (v === true) return true
  return /^(true|yes)$/i.test(String(v ?? '').trim())
}

/** Optional boolean — null when Bland couldn't determine it. */
function toBoolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (/^(true|yes)$/.test(s)) return true
  if (/^(false|no)$/.test(s)) return false
  return null
}

function parseAnswers(a: unknown[]): AnalyzedCallData {
  const interestRaw = (cleanStr(a[0]) || '').toLowerCase()
  const interested = interestRaw.includes('yes')
    ? 'yes'
    : interestRaw.includes('maybe')
      ? 'maybe'
      : interestRaw.includes('no')
        ? 'no'
        : null
  return {
    interested,
    objection: cleanStr(a[1]),
    do_not_call: toBool(a[2]),
    appointment_booked: toBool(a[3]),
    appointment_time: cleanStr(a[4]),
    callback_requested: toBool(a[5]),
    callback_time: cleanStr(a[6]),
    has_website: toBoolOrNull(a[7]),
    current_website: cleanStr(a[8]),
    budget_mentioned: cleanStr(a[9]),
    decision_maker: toBoolOrNull(a[10]),
    notes: cleanStr(a[11]),
  }
}

/**
 * Ask Bland to analyse a finished call and return the structured fields the CRM
 * cares about. Returns null if BLAND_API_KEY is missing or Bland reports an error
 * (e.g. voicemail/no transcript) — callers should treat that as "nothing extracted".
 */
export async function analyzeCall(callId: string): Promise<AnalyzedCallData | null> {
  const apiKey = process.env.BLAND_API_KEY
  if (!apiKey || !callId) return null

  let res: Response
  try {
    res = await fetch(`${BLAND_BASE}/v1/calls/${callId}/analyze`, {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: ANALYSIS_GOAL, questions: ANALYSIS_QUESTIONS }),
    })
  } catch (e) {
    console.error('[voice] analyzeCall: failed to reach Bland', (e as Error).message)
    return null
  }

  const body = await res.json().catch(() => null) as { status?: string; answers?: unknown[] } | null
  if (!res.ok || body?.status === 'error' || !Array.isArray(body?.answers)) {
    console.warn('[voice] analyzeCall: no usable analysis for call', callId, body?.status)
    return null
  }
  return parseAnswers(body.answers)
}
