/**
 * The signed cookie that remembers a passed share-link gate.
 *
 * Server-only: it reads the signing secret from the environment and uses node
 * crypto. Never import this into a client component — the pure half of the
 * share-link rules lives in lib/share-link.ts, which the client page and the
 * rep's Client Link tab both import.
 *
 * A passed gate is a signed cookie rather than a session row in the database:
 * there is nothing to clean up, it cannot be replayed against a different link
 * (the token is inside the signature), and it expires on its own.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { SHARE_SESSION_DAYS } from './share-link'

export function shareCookieName(token: string): string {
  // Scoped per token so opening a second client's link can't inherit the
  // first one's access, and revoking one link doesn't lock the client out of
  // another they legitimately hold.
  return `share_${token.replace(/[^a-zA-Z0-9-]/g, '')}`
}

function secret(): string {
  // No new env var to set on deploy: the service-role key is already required
  // by every route that uses this. SHARE_LINK_SECRET can override it later if
  // we ever want to rotate share access without touching Supabase keys.
  const s = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SHARE_LINK_SECRET / SUPABASE_SERVICE_ROLE_KEY is not set')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** Cookie value proving this device passed the gate for `token`. */
export function issueShareCookie(token: string): string {
  const exp = Date.now() + SHARE_SESSION_DAYS * 24 * 60 * 60 * 1000
  const payload = `${token}.${exp}`
  return `${payload}.${sign(payload)}`
}

/** True when `value` is a signature we issued for `token` and hasn't expired. */
export function verifyShareCookie(token: string, value: string | undefined | null): boolean {
  if (!value) return false

  const parts = value.split('.')
  if (parts.length !== 3) return false
  const [cookieToken, expStr, sig] = parts
  if (cookieToken !== token) return false

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false

  const a = Buffer.from(sig)
  const b = Buffer.from(sign(`${cookieToken}.${expStr}`))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
