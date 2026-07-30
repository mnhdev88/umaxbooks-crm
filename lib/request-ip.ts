// Request IP extraction + mail-provider proxy detection for email tracking.
//
// The app runs behind Nginx on the VPS, so the socket peer is always 127.0.0.1 —
// the real client is in X-Forwarded-For. Nginx appends to that header, so the list
// reads left-to-right as [original client, ...intermediate proxies]; the FIRST entry
// is the client. (Taking the last entry — a common mistake — yields our own proxy.)
//
// The header is client-controllable, so a spoofed value is possible. That is
// acceptable here: this data is sales-team context, never an authz decision.

export interface RequestOrigin {
  ip: string | null
  userAgent: string | null
  isProxy: boolean
  proxyName: string | null
}

/**
 * Pull the client IP out of the proxy headers. Returns null when no usable address
 * is present rather than a placeholder, so `ip IS NULL` stays meaningful in the DB.
 */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    // Left-most entry is the original client.
    for (const part of forwarded.split(',')) {
      const ip = normalizeIp(part.trim())
      if (ip) return ip
    }
  }

  // Fallbacks for other proxy setups (Cloudflare, some load balancers).
  for (const header of ['cf-connecting-ip', 'x-real-ip', 'true-client-ip']) {
    const ip = normalizeIp(headers.get(header)?.trim() || '')
    if (ip) return ip
  }

  return null
}

/**
 * Normalize one address: strip an IPv6-mapped IPv4 prefix, drop a :port suffix on
 * bare IPv4, unwrap bracketed IPv6, and reject loopback/unspecified addresses (which
 * mean "the proxy header never reached us" and would otherwise look like real data).
 */
function normalizeIp(raw: string): string | null {
  if (!raw) return null
  let ip = raw

  // "[2001:db8::1]:443" → "2001:db8::1"
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']')
    if (close > 0) ip = ip.slice(1, close)
  } else if (ip.split(':').length === 2) {
    // "203.0.113.5:54321" → "203.0.113.5". Only when there is exactly one colon,
    // so a bare IPv6 address is left intact.
    ip = ip.split(':')[0]
  }

  // "::ffff:203.0.113.5" → "203.0.113.5"
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) ip = mapped[1]

  if (!ip || ip === '::1' || ip === '::' || ip === '0.0.0.0') return null
  if (ip.startsWith('127.')) return null

  // Must look like an IPv4 or IPv6 literal — Postgres INET rejects anything else and
  // a bad value would fail the whole insert.
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
    ip.split('.').every(o => Number(o) <= 255)
  const isV6 = ip.includes(':') && /^[0-9a-f:]+$/i.test(ip)
  if (!isV4 && !isV6) return null

  return ip
}

// Mail-provider image proxies, identified by user agent. These fetch the pixel on the
// recipient's behalf, so the IP is the provider's datacenter and its location says
// nothing about the lead.
const PROXY_SIGNATURES: { pattern: RegExp; name: string }[] = [
  // Gmail + Google Workspace — "GoogleImageProxy" is unambiguous.
  { pattern: /GoogleImageProxy/i,                 name: 'gmail' },
  // Apple Mail Privacy Protection relays, and often prefetches, remote images.
  { pattern: /\bMasqueradingProxy\b/i,            name: 'apple' },
  // Outlook.com / Office 365 image proxying.
  { pattern: /OutlookImageProxy|ExchangeServicesClient|BingPreview/i, name: 'outlook' },
  { pattern: /YahooMailProxy|YahooCacheSystem/i,  name: 'yahoo' },
  { pattern: /ProofpointURLDefense|Barracuda/i,   name: 'security-scanner' },
]

export function detectProxy(userAgent: string | null): { isProxy: boolean; proxyName: string | null } {
  if (!userAgent) return { isProxy: false, proxyName: null }
  for (const { pattern, name } of PROXY_SIGNATURES) {
    if (pattern.test(userAgent)) return { isProxy: true, proxyName: name }
  }
  return { isProxy: false, proxyName: null }
}

/**
 * One call for the tracking routes: client IP, user agent, and whether this request
 * came from a mail-provider proxy rather than the recipient.
 */
export function getRequestOrigin(headers: Headers): RequestOrigin {
  const userAgent = headers.get('user-agent')
  const { isProxy, proxyName } = detectProxy(userAgent)
  return {
    ip: getClientIp(headers),
    // User agents can be long; cap so a hostile client can't bloat the row.
    userAgent: userAgent ? userAgent.slice(0, 500) : null,
    isProxy,
    proxyName,
  }
}
