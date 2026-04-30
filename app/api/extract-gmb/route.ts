import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

// ── Extract place_id or business name from a GMB URL ───────────────
async function resolveGmbUrl(rawUrl: string): Promise<{ placeId?: string; businessName?: string; lat?: number; lng?: number }> {
  let url = rawUrl.trim()

  // Resolve short URLs (maps.app.goo.gl, g.page, goo.gl/maps, g.co)
  if (/goo\.gl|g\.page|maps\.app|g\.co/.test(url)) {
    try {
      const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: HEADERS })
      url = resp.url
    } catch { /* keep original */ }
  }

  // Explicit place_id query param: ?q=place_id:ChIJ... or &place_id=...
  const qPlaceId = url.match(/place_id[=:](ChIJ[\w-]+)/i)
  if (qPlaceId) return { placeId: qPlaceId[1] }

  // place_id embedded in the data= segment: !1sChIJ... (ChIJ format only — hex IDs are invalid for Places API)
  const dataPlaceId = url.match(/!1s(ChIJ[\w-]+)/)
  if (dataPlaceId) return { placeId: dataPlaceId[1] }

  // /place/Business+Name/@ — extract name + optional coords (handles all standard Maps URLs)
  const placeSegment = url.match(/\/place\/([^/@?#]+)/)
  if (placeSegment) {
    const businessName = decodeURIComponent(placeSegment[1].replace(/\+/g, ' ')).trim()
    const coordMatch   = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    return {
      businessName,
      lat: coordMatch ? parseFloat(coordMatch[1]) : undefined,
      lng: coordMatch ? parseFloat(coordMatch[2]) : undefined,
    }
  }

  // CID: ?cid=1234 or &cid=1234 (last resort)
  const cid = url.match(/[?&]cid=(\d+)/)
  if (cid) return { placeId: `CID:${cid[1]}` }

  return {}
}

// ── Look up a place by CID via the Maps embed ──────────────────────
async function placeIdFromCid(cid: string): Promise<string | null> {
  const searchUrl = `https://www.google.com/maps?cid=${cid}&hl=en`
  try {
    const resp = await fetch(searchUrl, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
    const html = await resp.text()
    const match = html.match(/place_id[\\u003d:=]+["']?(ChIJ[\w-]+)/)
    return match ? match[1] : null
  } catch { return null }
}

// ── Fetch full place details from Places API ───────────────────────
async function fetchPlaceDetails(placeId: string, apiKey: string) {
  const fields = 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,website,types,address_components'
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${apiKey}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const json = await resp.json()
  if (json.status !== 'OK') {
    const msg = json.error_message ? `${json.status}: ${json.error_message}` : json.status
    throw new Error(`Places Details API — ${msg}`)
  }
  return json.result
}

// ── Text search: find by name (+ optional lat/lng bias) ────────────
async function textSearchPlace(businessName: string, lat: number | undefined, lng: number | undefined, apiKey: string) {
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(businessName)}&key=${apiKey}`
  if (lat !== undefined && lng !== undefined) url += `&location=${lat},${lng}&radius=5000`
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const json = await resp.json()
  if (json.status !== 'OK' || !json.results?.length) {
    const msg = json.error_message ? `${json.status}: ${json.error_message}` : json.status
    throw new Error(`Places Text Search API — ${msg}`)
  }
  return json.results[0].place_id as string
}

// ── Parse address_components ───────────────────────────────────────
function parseAddressComponents(components: any[]): { city: string; zip: string; country: string; streetAddress: string } {
  const get = (type: string) =>
    components.find((c: any) => c.types.includes(type))?.long_name || ''

  const streetNumber = get('street_number')
  const route        = get('route')
  const sublocality  = get('sublocality_level_1') || get('sublocality') || get('neighborhood')
  const city         = get('locality') || get('administrative_area_level_2') || get('administrative_area_level_1')
  const zip          = get('postal_code')
  const country      = get('country')
  const streetAddress = [streetNumber, route, sublocality].filter(Boolean).join(', ')

  return { city, zip, country, streetAddress }
}

// ── Scrape website for social media profile links ──────────────────
// Priority: Facebook → Instagram → LinkedIn → Twitter/X → YouTube → TikTok
async function scrapeSocialLinks(websiteUrl: string): Promise<{ social_url: string | null; all: Record<string, string | null> }> {
  try {
    const resp = await fetch(websiteUrl, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return { social_url: null, all: {} }
    const html = await resp.text()
    const $    = cheerio.load(html)
    const hrefs = $('a[href]').map((_, el) => $(el).attr('href') || '').get()

    const pick = (pattern: RegExp) => hrefs.find(h => pattern.test(h)) || null

    const all = {
      facebook:  pick(/facebook\.com\/(?!share|sharer|dialog|plugins|tr\b)/),
      instagram: pick(/instagram\.com\/(?!p\/|reel\/|explore\/)/),
      linkedin:  pick(/linkedin\.com\/(company|in|school)\//),
      twitter:   pick(/(?:twitter|x)\.com\/(?!intent|share|home|login)/),
      youtube:   pick(/youtube\.com\/(channel|c\/|@|user\/)/),
      tiktok:    pick(/tiktok\.com\/@/),
    }

    // Pick the highest-priority non-null link
    const priority: (keyof typeof all)[] = ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'tiktok']
    const social_url = priority.map(k => all[k]).find(Boolean) || null

    return { social_url, all }
  } catch {
    return { social_url: null, all: {} }
  }
}

// ── Ignored GMB type tokens ────────────────────────────────────────
const IGNORED_TYPES = new Set(['point_of_interest', 'establishment', 'premise', 'food', 'store'])

// ── Handler ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { gmbUrl } = await req.json()
    if (!gmbUrl) return NextResponse.json({ error: 'gmbUrl required' }, { status: 400 })

    const apiKey = process.env.GOOGLE_MAPS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not configured in environment' }, { status: 500 })

    // 1. Resolve URL → placeId or businessName
    const resolved = await resolveGmbUrl(gmbUrl)
    console.log('[extract-gmb] resolved:', JSON.stringify(resolved))

    let placeId = resolved.placeId

    // 2. CID sentinel → try to resolve to ChIJ place_id
    if (placeId?.startsWith('CID:')) {
      const cid = placeId.replace('CID:', '')
      placeId = await placeIdFromCid(cid) || undefined
      if (!placeId && !resolved.businessName) {
        return NextResponse.json({
          error: 'Could not resolve CID. Try pasting the full Google Maps URL instead.',
        }, { status: 422 })
      }
    }

    // 3. No placeId → text search by name
    if (!placeId) {
      if (!resolved.businessName) {
        return NextResponse.json({
          error: 'Unrecognized URL format. Paste the full Google Maps URL (e.g. google.com/maps/place/...).',
        }, { status: 422 })
      }
      placeId = await textSearchPlace(resolved.businessName, resolved.lat, resolved.lng, apiKey)
    }

    console.log('[extract-gmb] placeId:', placeId)

    // 4. Fetch place details + scrape website social links in parallel
    const [place, socialResult] = await Promise.all([
      fetchPlaceDetails(placeId, apiKey),
      // Social scrape only starts if we know the website URL upfront — otherwise
      // we re-run it after getting the website from place details (see step 5).
      Promise.resolve(null),
    ])

    // 5. If the place has a website, scrape it for social profiles
    const websiteUrl = place.website || ''
    const social = websiteUrl ? await scrapeSocialLinks(websiteUrl) : { social_url: null, all: {} }
    console.log('[extract-gmb] social:', JSON.stringify(social.all))

    // 6. Parse address components
    const addr = parseAddressComponents(place.address_components || [])

    const category = (place.types as string[] | undefined)
      ?.filter((t: string) => !IGNORED_TYPES.has(t))
      .map((t: string) => t.replace(/_/g, ' '))
      .slice(0, 2)
      .map((t: string) => t.charAt(0).toUpperCase() + t.slice(1))
      .join(', ') || ''

    return NextResponse.json({
      name:              place.name || '',
      phone:             place.formatted_phone_number || '',
      address:           addr.streetAddress || place.formatted_address || '',
      city:              addr.city || '',
      zip_code:          addr.zip || '',
      country:           addr.country || '',
      website_url:       websiteUrl,
      gmb_review_rating: place.rating ?? '',
      number_of_reviews: place.user_ratings_total ?? '',
      gmb_category:      category,
      gmb_last_seen:     new Date().toISOString().split('T')[0],
      social_url:        social.social_url || '',
      social_profiles:   social.all,   // full breakdown for debugging / future use
      place_id:          placeId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 })
  }
}
