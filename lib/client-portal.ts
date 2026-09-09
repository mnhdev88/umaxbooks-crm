/**
 * The common client front door — the rules shared by the request-code and
 * verify-code routes.
 *
 * Server-only (node crypto). The front door itself is a static page on
 * Cloudflare Pages; everything below runs here, on the CRM.
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto'

/** How long an issued code stays usable. */
export const CODE_TTL_MINUTES = 10

/** Wrong guesses allowed against one issued code before it is burned. */
export const MAX_CODE_ATTEMPTS = 5

/** Codes one phone number may request in the window below. */
export const MAX_CODES_PER_PHONE = 3

/** Codes one IP may request in the window below. Blunt anti-enumeration brake. */
export const MAX_CODES_PER_IP = 5

/** The rate-limit window for both caps above. */
export const RATE_WINDOW_MINUTES = 15

/** How long the handoff key that carries a verified visitor to the CRM lives. */
export const HANDOFF_TTL_SECONDS = 60

/** Origins allowed to call the front-door routes from a browser. */
export function allowedOrigins(): string[] {
  const configured = (process.env.CLIENT_PORTAL_ORIGINS || '')
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean)

  // The deployed front door, plus local dev of the same static page. Kept as a
  // default so a missing env var can't silently lock every client out.
  const builtIn = [
    'https://data123.pages.dev',
    'http://localhost:3000',
    'http://localhost:8788',
  ]

  return Array.from(new Set([...configured, ...builtIn]))
}

/**
 * CORS headers for a front-door route. Echoes the origin only when it is
 * allowlisted — never `*`, because these responses are read with credentials
 * and carry a masked destination.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && allowedOrigins().includes(origin.replace(/\/$/, ''))
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Last 10 digits — the normalisation lead_id_for_phone() uses (migration 092). */
export function phoneDigits(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

export type Identifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | null

/**
 * What the client typed at the front door, normalised into something we can
 * look a lead up by and rate-limit on.
 *
 * A client remembers whichever detail they gave us — often the email, since
 * that is where proposals arrive — so the field takes either. An '@' is the
 * only signal needed to tell them apart: no phone number contains one, and any
 * email must.
 */
export function parseIdentifier(raw: unknown): Identifier {
  const text = String(raw ?? '').trim()
  if (!text) return null

  if (text.includes('@')) {
    const email = text.toLowerCase()
    // Deliberately loose. The address either matches a lead on file or it
    // doesn't; rejecting unusual-but-valid addresses here would just turn a
    // "we don't have that on file" into a confusing "invalid email".
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: 'email', value: email } : null
  }

  const digits = phoneDigits(text)
  return digits ? { kind: 'phone', value: digits } : null
}

/** A 6-digit code, uniformly random. Leading zeros are kept. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function secret(): string {
  const s = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SHARE_LINK_SECRET / SUPABASE_SERVICE_ROLE_KEY is not set')
  return s
}

/** Salted hash of a code. The code itself is never stored. */
export function hashCode(code: string): string {
  return createHash('sha256').update(`${code}.${secret()}`).digest('hex')
}

/** Constant-time comparison of a submitted code against a stored hash. */
export function codeMatches(submitted: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(submitted))
  const b = Buffer.from(storedHash)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** "najeeb@gmail.com" → "n••••b@gmail.com" — enough to recognise, not to read. */
export function maskEmail(email: string): string {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  if (user.length <= 2) return `${user[0]}•@${domain}`
  return `${user[0]}${'•'.repeat(Math.min(user.length - 2, 5))}${user[user.length - 1]}@${domain}`
}

/** "+18135551234" → "(•••) •••-1234". */
export function maskPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length < 4) return ''
  return `(•••) •••-${d.slice(-4)}`
}
