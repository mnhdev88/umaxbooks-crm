/**
 * The common client front door — the rules the open route relies on.
 *
 * A client types their phone number or email at nda123.pages.dev and is taken
 * straight to their documents. There is no code step: see migration 113 for
 * what that trades away and why it is deliberate.
 *
 * Server-only. The front door itself is a static page on Cloudflare Pages;
 * everything below runs here, on the CRM.
 */

/**
 * Lookups one IP may make in the window below.
 *
 * With the code step gone this is the only brake on someone walking a list of
 * business emails, so it matters more than a rate limit usually would. Set high
 * enough that a shared office or phone network never notices, low enough that
 * bulk scraping is pointless.
 */
export const MAX_LOOKUPS_PER_IP = 20

/** The rate-limit window. */
export const RATE_WINDOW_MINUTES = 15

/** How long the handoff key that carries a visitor to the CRM lives. */
export const HANDOFF_TTL_SECONDS = 60

/** Origins allowed to call the front-door route from a browser. */
export function allowedOrigins(): string[] {
  const configured = (process.env.CLIENT_PORTAL_ORIGINS || '')
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean)

  // The deployed front door, plus local dev of the same static page. Kept as a
  // default so a missing env var can't silently lock every client out.
  const builtIn = [
    'https://nda123.pages.dev',
    'http://localhost:3000',
    'http://localhost:8788',
  ]

  return Array.from(new Set([...configured, ...builtIn]))
}

/**
 * True when this Origin may call the front-door route.
 *
 * Exact matches from allowedOrigins(), plus any SUBDOMAIN of an allowlisted
 * pages.dev host. Cloudflare gives every deployment its own preview URL
 * (`<hash>.nda123.pages.dev`, `<branch>.nda123.pages.dev`), and that is the
 * link the dashboard shows you after an upload — allowlisting only the
 * production hostname means testing a fresh deployment fails with an opaque
 * "Failed to fetch" that looks like the API is down.
 *
 * Scoped to the project's own pages.dev host, never `*.pages.dev`: that would
 * let anybody's Cloudflare Pages site call this route.
 */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return false
  const candidate = origin.replace(/\/$/, '')

  return allowedOrigins().some(allowed => {
    if (candidate === allowed) return true
    if (!allowed.endsWith('.pages.dev')) return false

    // https://nda123.pages.dev → also allow https://<label>.nda123.pages.dev.
    // Done with string comparison rather than a built regex: the host has to
    // match exactly, and an unescaped dot in a generated pattern would quietly
    // widen this to match hosts we never meant to allow.
    const host = allowed.replace(/^https?:\/\//, '')
    if (!candidate.startsWith('https://')) return false

    const candidateHost = candidate.slice('https://'.length)
    const dot = candidateHost.indexOf('.')
    if (dot <= 0) return false

    const label = candidateHost.slice(0, dot)
    // Exactly one extra label, and a legal one — so a.b.nda123.pages.dev and
    // anything with a path or port is refused.
    return candidateHost.slice(dot + 1) === host && /^[a-z0-9-]+$/i.test(label)
  })
}

/**
 * CORS headers for the front-door route. Echoes the origin only when it is
 * allowlisted — never `*`.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = originAllowed(origin)
  return {
    ...(allowed && origin ? { 'Access-Control-Allow-Origin': origin } : {}),
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
