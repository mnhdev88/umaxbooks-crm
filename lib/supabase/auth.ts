import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Request-scoped auth helpers.
 *
 * WHY THIS EXISTS: `supabase.auth.getUser()` is a network round-trip to the auth
 * server, and it was being called 92 times across the codebase — 2 layouts, 34
 * pages, 44 API routes. A single dashboard navigation paid for it at least three
 * times (proxy, then the layout, then the page), and every open tab's polling
 * paid again on each tick. That totalled ~19,700 /auth/v1/user calls a day and
 * peaked at 522/min; on 2026-08-21 15:04 the auth server returned 504 for 66 of
 * them and every session appeared to log out at once.
 *
 * Two fixes, both applied here:
 *
 *  1. getClaims() instead of getUser(). This project signs JWTs with ES256, so
 *     the token is verified locally against a cached JWKS — no auth-server call
 *     after the first key fetch, and nothing left to time out. The claims are
 *     cryptographically verified, so `sub` is as trustworthy as getUser()'s id.
 *
 *  2. React cache(). Memoizes per request, so a layout and the page it wraps
 *     share one result instead of resolving separately.
 *
 * TRADEOFF: a session revoked server-side stays valid until its access token
 * expires (~1h) rather than dying on the next request. Anything that must react
 * immediately — a role change, a deactivated profile — should read the DB, which
 * is what getCurrentProfile() below does.
 *
 * Use getCurrentUser() wherever you only need "who is this / are they logged in".
 * Reach for supabase.auth.getUser() only when you specifically need live
 * server-side session validation.
 */

export type CurrentUser = {
  id: string
  email?: string
  /** Raw verified JWT claims, for the rare caller that needs more than the id. */
  claims: Record<string, unknown>
}

/** The signed-in user, or null. Verified locally; memoized per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  const claims = data?.claims
  const id = claims?.sub
  if (!claims || typeof id !== 'string') return null

  return {
    id,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    claims: claims as Record<string, unknown>,
  }
})

/**
 * The signed-in user's profile row, or null. Memoized per request — the sidebar,
 * the layout and the page all want the role, and before this they each fetched
 * it separately.
 *
 * This DOES hit the database, deliberately: it is the check that makes a role
 * change or a deactivated account take effect on the very next request, which
 * the locally-verified JWT above cannot do on its own.
 */
export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return data
})
