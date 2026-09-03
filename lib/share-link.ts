/**
 * Client share links (/share/<token>) — the rules the public page, the verify
 * route, the file proxy and the rep's Client Link tab all have to agree on.
 *
 * Deliberately free of node imports: the share page and the lead tab are client
 * components, so anything they need has to survive the browser bundle. The
 * cookie signing that can't lives in lib/share-cookie.ts.
 */

/** How long a freshly generated link stays openable. */
export const SHARE_LINK_DAYS = 30

/** How long a passed last-4 check is remembered on the client's device. */
export const SHARE_SESSION_DAYS = 30

/** Wrong last-4 entries allowed before the link locks. */
export const MAX_GATE_ATTEMPTS = 5

/** How long the link stays locked once the cap is hit. */
export const GATE_LOCK_MINUTES = 15

export const SHARE_SECTIONS = ['proposal', 'contract', 'audit'] as const
export type ShareSection = (typeof SHARE_SECTIONS)[number]

export const SECTION_LABELS: Record<ShareSection, string> = {
  proposal: 'Proposal',
  contract: 'Agreement',
  audit:    'SEO Audit',
}

/** Narrow an untrusted value into a list of sections; [] when nothing is usable. */
export function sanitizeSections(value: unknown): ShareSection[] {
  if (!Array.isArray(value)) return []
  const out: ShareSection[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const s = entry.trim().toLowerCase()
    if ((SHARE_SECTIONS as readonly string[]).includes(s) && !out.includes(s as ShareSection)) {
      out.push(s as ShareSection)
    }
  }
  // Keep the canonical order regardless of what the browser sent, so the tabs
  // never come back in a different order than the rep ticked them.
  return SHARE_SECTIONS.filter(s => out.includes(s))
}

export interface ShareLinkRow {
  expires_at?: string | null
  revoked_at?: string | null
}

export type ShareLinkState = 'active' | 'revoked' | 'expired'

export function shareLinkState(link: ShareLinkRow): ShareLinkState {
  if (link.revoked_at) return 'revoked'
  const exp = link.expires_at ? Date.parse(link.expires_at) : NaN
  if (!Number.isNaN(exp) && Date.now() > exp) return 'expired'
  return 'active'
}

/** True while a failed-attempt lockout is still in force. */
export function gateLocked(link: { locked_until?: string | null }): boolean {
  const until = link.locked_until ? Date.parse(link.locked_until) : NaN
  return !Number.isNaN(until) && Date.now() < until
}

/** Digits only — strips +, spaces, dashes, brackets and any country formatting. */
export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

/** Last 4 digits of a phone number, or '' when there aren't 4 to take. */
export function last4(value: unknown): string {
  const d = digitsOnly(value)
  return d.length >= 4 ? d.slice(-4) : ''
}

interface LeadPhones {
  phone?: string | null
  whatsapp_number?: string | null
  alt_phones?: unknown
}

/**
 * Every last-4 that opens this lead's link: the primary number, WhatsApp, and
 * anything in alt_phones (migration 076). Read live from the lead rather than
 * snapshotted onto the link, so fixing a wrong number fixes the link too.
 */
export function acceptedLast4(lead: LeadPhones): string[] {
  const raw: unknown[] = [lead.phone, lead.whatsapp_number]
  if (Array.isArray(lead.alt_phones)) {
    for (const p of lead.alt_phones) {
      if (p && typeof p === 'object' && 'value' in p) raw.push((p as { value?: unknown }).value)
    }
  }
  const out: string[] = []
  for (const v of raw) {
    const four = last4(v)
    if (four && !out.includes(four)) out.push(four)
  }
  return out
}
