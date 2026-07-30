// IP → city/region/country resolution via ip-api.com.
//
// Used to fill in the geo_* columns on email_engagement_events after the fact. The
// tracking routes deliberately never call this: the open pixel must return its GIF
// immediately, and a blocking HTTP lookup would stall the recipient's mail client.
//
// ip-api.com free tier, chosen for zero setup (no key, no local database):
//   - batch endpoint takes up to 100 IPs per request, so one call covers a whole run
//   - 15 batch requests/minute; we do far less than that
//   - HTTP only on the free tier (HTTPS is paid). We send nothing but the IP itself,
//     and the reply is non-sensitive city/country data, so plaintext is acceptable —
//     but it is the reason to prefer a local MaxMind DB if this ever moves to volume.

const BATCH_ENDPOINT = 'http://ip-api.com/batch'

// ip-api caps a batch at 100 queries.
export const GEO_BATCH_SIZE = 100

// Only ask for the fields we store, plus status/message for error handling. A smaller
// payload is faster and keeps us clear of the response-size limits.
const FIELDS = 'status,message,query,city,regionName,countryCode'

export interface GeoResult {
  ip: string
  city: string | null
  region: string | null
  country: string | null
}

interface IpApiRow {
  status?: string
  message?: string
  query?: string
  city?: string
  regionName?: string
  countryCode?: string
}

/**
 * Resolve up to GEO_BATCH_SIZE IPs in one request.
 *
 * Returns only the IPs that resolved successfully. A private/reserved address makes
 * ip-api return status 'fail' — those are dropped rather than surfaced as an error,
 * since the caller can't do anything about them and they must not be retried forever.
 *
 * Throws on transport/HTTP failure so the caller can distinguish "the service is
 * down, try again next run" from "these IPs are unresolvable".
 */
export async function resolveIpBatch(ips: string[]): Promise<GeoResult[]> {
  if (ips.length === 0) return []
  if (ips.length > GEO_BATCH_SIZE) {
    throw new Error(`resolveIpBatch: ${ips.length} IPs exceeds the ${GEO_BATCH_SIZE} batch limit`)
  }

  const res = await fetch(`${BATCH_ENDPOINT}?fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ips.map(ip => ({ query: ip }))),
    // Don't let a hung upstream stall the cron run.
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })

  if (!res.ok) {
    // 429 is the documented rate-limit response; treat it like any other failure and
    // let the next run pick the backlog up.
    throw new Error(`ip-api batch failed: HTTP ${res.status}`)
  }

  const rows = (await res.json()) as IpApiRow[]
  if (!Array.isArray(rows)) {
    throw new Error('ip-api batch returned an unexpected payload')
  }

  const out: GeoResult[] = []
  for (const row of rows) {
    if (row.status !== 'success' || !row.query) continue
    // An empty string from the API means "unknown", which we store as NULL.
    const city    = row.city?.trim()       || null
    const region  = row.regionName?.trim() || null
    const country = row.countryCode?.trim() || null
    // Nothing usable came back — skip rather than marking it resolved-but-empty.
    if (!city && !region && !country) continue
    out.push({ ip: row.query, city, region, country })
  }

  return out
}

/** Human-readable "City, Region, CC" for the denormalised summary column. */
export function formatGeoLabel(geo: { city: string | null; region: string | null; country: string | null }): string | null {
  const parts = [geo.city, geo.region, geo.country].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
