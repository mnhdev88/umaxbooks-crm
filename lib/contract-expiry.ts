/**
 * Signing-link expiry for contracts.
 *
 * Deliberately computed from sent_at rather than stored: there is no cron on the VPS to
 * flip statuses, and a derived answer can't drift from the truth. A contract's status
 * column still only ever says sent/signed/cancelled — "expired" is what we call a `sent`
 * contract whose window has passed, everywhere one is displayed or a signature is
 * accepted.
 */

export const CONTRACT_LINK_DAYS = 7

const WINDOW_MS = CONTRACT_LINK_DAYS * 24 * 60 * 60 * 1000

/** True when this is a `sent` contract whose signing window has passed. */
export function contractLinkExpired(c: {
  status: string
  sent_at?: string | null
  created_at?: string | null
}): boolean {
  if (c.status !== 'sent') return false
  const sent = c.sent_at || c.created_at
  if (!sent) return false
  const t = Date.parse(sent)
  if (Number.isNaN(t)) return false
  return Date.now() - t > WINDOW_MS
}
