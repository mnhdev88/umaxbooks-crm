import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

async function scrapeWebsite(rawUrl: string) {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const t0 = Date.now()
  const resp = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  })
  const loadMs = Date.now() - t0
  const html = await resp.text()
  const $ = cheerio.load(html)

  const title = $('title').text().trim()
  const metaDescription =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''
  const metaKeywords = $('meta[name="keywords"]').attr('content') || ''
  const ogImage = $('meta[property="og:image"]').attr('content') || ''

  const h1 = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean)
  const h2 = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 8)

  const allHrefs = $('a[href]').map((_, el) => $(el).attr('href') || '').get()
  const socialLinks = {
    facebook: allHrefs.find(h => /facebook\.com\/(?!share|sharer)/.test(h)) || null,
    instagram: allHrefs.find(h => h.includes('instagram.com/')) || null,
    twitter: allHrefs.find(h => h.includes('twitter.com/') || h.includes('x.com/')) || null,
    youtube: allHrefs.find(h => h.includes('youtube.com/')) || null,
    linkedin: allHrefs.find(h => h.includes('linkedin.com/')) || null,
    tiktok: allHrefs.find(h => h.includes('tiktok.com/')) || null,
  }

  const bodyText = $('body').text()
  const phoneMatches = bodyText.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g) || []
  const phones = [...new Set(phoneMatches.map(p => p.trim()).slice(0, 5))]

  const emailMatches = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
  const emails = [...new Set(emailMatches.filter(e => !e.includes('.png') && !e.includes('.jpg')).slice(0, 3))]

  const hasGoogleAnalytics =
    html.includes('google-analytics.com') ||
    html.includes('gtag(') ||
    html.includes('googletagmanager.com')
  const hasFacebookPixel = html.includes('fbq(') || html.includes('facebook.net/en_US/fbevents')
  const hasSchemaMarkup = html.includes('application/ld+json')
  const hasSSL = url.startsWith('https://')
  const hasContactForm = $('form').length > 0
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length
  const imageCount = $('img').length
  const hasChat = html.includes('tawk.to') || html.includes('crisp.chat') || html.includes('intercom') || html.includes('drift.com')

  // Extract schema types
  const schemaTypes: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '')
      if (data['@type']) schemaTypes.push(data['@type'])
    } catch {}
  })

  return {
    url,
    hasSSL,
    loadMs,
    title,
    metaDescription,
    metaKeywords,
    ogImage,
    h1,
    h2,
    socialLinks,
    phones,
    emails,
    hasGoogleAnalytics,
    hasFacebookPixel,
    hasSchemaMarkup,
    schemaTypes,
    hasContactForm,
    hasChat,
    wordCount,
    imageCount,
    statusCode: resp.status,
  }
}

async function scrapeGMB(businessName: string, city: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  const query = `${businessName} ${city}`.trim()

  // ── Step 1: Text Search to get place_id ───────────────────────────────────
  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
  const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })
  const searchJson = await searchResp.json()

  if (searchJson.status !== 'OK' || !searchJson.results?.length) return null

  const placeId: string = searchJson.results[0].place_id

  // ── Step 2: Place Details for full GMB data ───────────────────────────────
  const fields = 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,website,types,price_level,opening_hours,editorial_summary,business_status'
  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`
  const detailResp = await fetch(detailUrl, { signal: AbortSignal.timeout(10000) })
  const detailJson = await detailResp.json()

  if (detailJson.status !== 'OK' || !detailJson.result) return null

  const p = detailJson.result

  const PRICE_LABELS: Record<number, string> = { 0: 'Free', 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' }
  const ignoredTypes = new Set(['point_of_interest', 'establishment', 'premise'])
  const categories = (p.types as string[] | undefined)
    ?.filter(t => !ignoredTypes.has(t))
    .map(t => t.replace(/_/g, ' '))
    .join(', ') || null

  return {
    name: p.name || businessName,
    rating: p.rating ?? null,
    reviewCount: p.user_ratings_total ?? null,
    address: p.formatted_address || null,
    phone: p.formatted_phone_number || null,
    website: p.website || null,
    categories,
    priceRange: p.price_level != null ? PRICE_LABELS[p.price_level] ?? null : null,
    hours: (p.opening_hours?.weekday_text as string[] | undefined) ?? [],
    description: p.editorial_summary?.overview || null,
    businessStatus: p.business_status || null,
    placeId,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || businessName)}&query_place_id=${placeId}`,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { websiteUrl, businessName, city } = await req.json()

    const [website, gmb] = await Promise.allSettled([
      websiteUrl ? scrapeWebsite(websiteUrl) : Promise.resolve(null),
      businessName ? scrapeGMB(businessName, city || '') : Promise.resolve(null),
    ])

    return NextResponse.json({
      website: website.status === 'fulfilled' ? website.value : { error: (website as PromiseRejectedResult).reason?.message || 'Failed to scrape website' },
      gmb: gmb.status === 'fulfilled' ? gmb.value : { error: (gmb as PromiseRejectedResult).reason?.message || 'Failed to scrape GMB' },
      scrapedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
