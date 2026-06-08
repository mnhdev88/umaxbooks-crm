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
const AGENCY_PHONE = process.env.NEXT_PUBLIC_AGENCY_PHONE || ''
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

/** Normalise a US phone number to E.164 (+1XXXXXXXXXX). */
export function toE164US(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
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
 * already has a website. Keeps a short AI disclosure up front (legally required for
 * AI-placed calls in several US states); the rest follows the KB's pain-first openers.
 */
function buildFirstSentence(input: StartCallInput): string {
  const firstName = firstNameOf(input.name)
  const city = input.city?.trim()
  const where = city ? ` in ${city}` : ' in your area'
  const service = serviceWord(input.businessType)
  const disclosure = `quick heads up, I'm ${AGENT_NAME}, an AI assistant`
  const hasWebsite = !!input.website?.trim()

  if (hasWebsite) {
    // "Outdated / ranking low" opener.
    return (
      `Hi, is this ${firstName}? — ${disclosure}. I was reviewing your website and comparing it ` +
      `to what Google is looking for right now, and there are a few things quietly pushing you down ` +
      `in search results${city ? ` for ${service} ${where}` : ''}. This isn't your fault — Google ` +
      `changed its requirements. Worth two minutes to hear what I found?`
    )
  }
  // "No website" opener.
  return (
    `Hi, is this ${firstName}? — ${disclosure}. I ran a quick check on local ${service}${where} ` +
    `and noticed you don't have a website, but a few of your competitors do and they're showing up ` +
    `every time someone searches. I pulled together a few notes on what that's costing you. Two minutes?`
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
      ? `- Demo status: A working demo site HAS been pre-built for this business. You MAY use the "we already built you a working website, it's sitting on our server" close.`
      : `- Demo status: NO demo has been built yet. CRITICAL: do NOT claim a website already exists or is "sitting on our server." Instead, use the audit-finding framing and OFFER to build a free, no-obligation demo and walk them through it. Never imply a finished site exists.`,
  ].join('\n')

  return [
    `You are ${AGENT_NAME}, a warm, calm, professional AI voice agent for ${AGENCY_NAME}.`,
    `You are placing an OUTBOUND cold call to a US local-service business owner.`,
    `If anyone asks, state plainly that you are an AI assistant — you already disclosed this in your opening line.`,
    '',
    context,
    '',
    'Delivery rules:',
    '- Speak at a calm, measured, unhurried pace. Pause briefly after questions. Never rush or talk over them.',
    '- Follow the knowledge base below EXACTLY: its openers, bridge, discovery questions, objection handling, and the free-demo close.',
    '- Pain before product, always. Do not pitch price unless they ask; if asked, the demo is free and live starts at $600.',
    '- Your single goal is to book a 15-minute walkthrough — always offer two specific time slots, never open-ended.',
    '- Do not invent services, results, prices, or guarantees beyond the knowledge base. Defer specifics to the human specialist.',
    '- If they ask not to be called or say they are not interested after one rebuttal, apologise, thank them, and end politely.',
    AGENCY_PHONE ? `- If they ask for a callback number, give ${AGENCY_PHONE}.` : '',
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
  const callback = AGENCY_PHONE ? ` Give me a call back at ${AGENCY_PHONE}` : ' Give me a call back'
  const hasWebsite = !!input.website?.trim()
  // Only claim a built demo when one actually exists; otherwise offer to build one.
  const demoLine = input.demoReady
    ? 'I actually put together a quick demo website for your business to show you what it could look like — completely free, no obligation.'
    : "I'd love to show you, free and with no obligation, exactly what's costing you customers and what a fix would look like."

  if (hasWebsite) {
    return (
      `Hi ${firstName}, this is ${AGENT_NAME}, an AI assistant from ${AGENCY_NAME}. I ran a quick search for ` +
      `${service}${where} and your competitor came up right away — your business didn't show. I found a few ` +
      `specific things holding you back. ${demoLine}${callback}. Thank you!`
    )
  }
  return (
    `Hi ${firstName}, this is ${AGENT_NAME}, an AI assistant from ${AGENCY_NAME}. I was looking up ${service}` +
    `${where} today and noticed your business doesn't have a website, but your competitors do and they're ` +
    `showing up every time someone searches. ${demoLine}${callback}. Thank you!`
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

  const payload: Record<string, unknown> = {
    phone_number: toE164US(input.phone),
    // Caller ID — the number you purchased in Bland. If unset, Bland uses a shared/random number.
    from: process.env.BLAND_FROM_NUMBER || undefined,
    voice: process.env.BLAND_VOICE || 'june',
    // How long (ms) the agent waits before responding. Higher = more patient, less
    // rushed, won't talk over the lead. Default Bland is 500; we use 800 for a calmer feel.
    interruption_threshold: Number(process.env.BLAND_INTERRUPTION_THRESHOLD) || 800,
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
