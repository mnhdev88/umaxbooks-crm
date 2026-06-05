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

const BLAND_BASE = 'https://api.bland.ai'

const AGENCY_NAME = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'
const AGENCY_PHONE = process.env.NEXT_PUBLIC_AGENCY_PHONE || ''

/**
 * Business profile the AI agent speaks from. Edit these strings to change what the
 * agent says about Novelio — no need to touch the call logic below.
 */
const BUSINESS = {
  name: AGENCY_NAME,
  // One-line identity used in the opening and intro.
  oneLiner: 'a business growth partner that has helped US small businesses since 2014',
  // What Novelio actually does (kept conversational — the agent paraphrases these).
  services: [
    'redesigning and speeding up websites so they turn visitors into leads',
    'optimizing Google Business Profiles so they show up in local search and Maps',
    'lead generation and follow-up automation',
    'branding and day-to-day business operations',
  ],
  // The core value proposition / hook.
  pitch:
    'We turn slow, under-performing websites into high-converting lead machines, ' +
    'and help small businesses get found, get leads, and run more smoothly.',
  // The single action we want from the call.
  goal: 'book a free, no-obligation strategy call with a Novelio specialist',
}

export interface StartCallInput {
  /** Destination phone number. Accepts US 10-digit, 1XXXXXXXXXX, or E.164. */
  phone: string
  /** Lead's name, used to personalise the opening line. */
  name?: string
  /** Lead's company, used for context in the qualification script. */
  company?: string
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

/** Opening line — includes a clear AI disclosure (do not remove). */
function buildFirstSentence(name?: string, company?: string): string {
  const firstName = name?.trim().split(/\s+/)[0] || 'there'
  const businessRef = company?.trim() ? `, for ${company.trim()},` : ''
  return (
    `Hi ${firstName}, this is Aria, an AI assistant calling on behalf of ${BUSINESS.name}. ` +
    `You recently connected with us${businessRef} about growing your business online. ` +
    `Is now a good time for a quick two-minute chat?`
  )
}

/** The conversation instructions (Bland "task"). */
function buildTask(name?: string, company?: string): string {
  const who = name?.trim() ? `You are speaking with ${name.trim()}.` : ''
  const biz = company?.trim() ? `They run a business called ${company.trim()}.` : ''
  return [
    `You are Aria, a warm, professional, and concise AI voice assistant for ${BUSINESS.name}, ${BUSINESS.oneLiner}.`,
    `You are making an OUTBOUND call to a US small-business owner who is a lead for ${BUSINESS.name}. ${who} ${biz}`.trim(),
    `Many of these leads recently received a free website performance report from us, so they may already know us.`,
    '',
    `About ${BUSINESS.name} (speak naturally, do not read this like a list):`,
    BUSINESS.pitch,
    'Specifically, we help with:',
    ...BUSINESS.services.map(s => `- ${s}`),
    '',
    'Goals for this call, in order:',
    '1. Confirm you are speaking to the right person and that it is a good time.',
    '2. Ask what their biggest challenge is right now — for example their website, showing up on Google, or getting more leads.',
    '3. Briefly connect ONE relevant Novelio service to what they say (do not pitch everything).',
    `4. ${BUSINESS.goal[0].toUpperCase() + BUSINESS.goal.slice(1)} — confirm a day and time that works, and that a specialist will call them.`,
    '',
    'Rules:',
    '- Speak at a calm, measured, unhurried pace. Slow down. Pause briefly after questions and between sentences. Never rush your words.',
    '- Keep it natural, warm, and short — only a couple of minutes. Let them talk; listen more than you pitch.',
    '- You are an AI assistant; if asked, say so plainly (you already disclosed this in your opening line).',
    '- Do NOT quote firm prices, timelines, or make contractual promises. Defer all specifics to the human specialist.',
    '- Do not invent services, results, or guarantees beyond what is listed above.',
    '- If they are not interested or ask not to be called, apologize, thank them, and end politely.',
    `- At the end, thank them and confirm a ${BUSINESS.name} specialist will follow up.`,
  ].join('\n')
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
    voice: process.env.BLAND_VOICE || 'june',
    // How long (ms) the agent waits before responding. Higher = more patient, less
    // rushed, won't talk over the lead. Default Bland is 500; we use 800 for a calmer feel.
    interruption_threshold: Number(process.env.BLAND_INTERRUPTION_THRESHOLD) || 800,
    first_sentence: buildFirstSentence(input.name, input.company),
    wait_for_greeting: true,
    record: true,
    max_duration: 12, // minutes — safety cap
    voicemail_action: 'leave_message',
    voicemail_message:
      `Hi, this is Aria, an AI assistant from ${BUSINESS.name}. We help small businesses grow with better ` +
      `websites, Google visibility, and lead generation, and we'd love to connect about your business. ` +
      `Please call us back${AGENCY_PHONE ? ` at ${AGENCY_PHONE}` : ''}. Thank you!`,
    metadata: input.leadId ? { leadId: input.leadId } : undefined,
    webhook: buildWebhookUrl(),
  }

  // Prefer a saved Pathway if configured; otherwise use the inline task.
  const pathwayId = process.env.BLAND_PATHWAY_ID
  if (pathwayId) {
    payload.pathway_id = pathwayId
    payload.request_data = { name: input.name, company: input.company }
  } else {
    payload.task = buildTask(input.name, input.company)
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
