import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

type Status = 'pass' | 'warn' | 'fail'

interface Check {
  key: string
  label: string
  status: Status
  value: string
  /** Why it matters — shown to the client on the demo call */
  impact: string
}

/** Recommended title length window, in characters. */
const TITLE_MIN = 30
const TITLE_MAX = 60
/** Recommended meta description window, in characters. */
const DESC_MIN = 70
const DESC_MAX = 160

function detectCms($: cheerio.CheerioAPI, html: string): string {
  const generator = $('meta[name="generator"]').attr('content') || ''
  if (/wordpress/i.test(generator) || /wp-content|wp-includes/.test(html)) return 'WordPress'
  if (/shopify/i.test(generator) || /cdn\.shopify\.com/.test(html)) return 'Shopify'
  if (/wix/i.test(generator) || /static\.wixstatic\.com/.test(html)) return 'Wix'
  if (/squarespace/i.test(generator) || /squarespace\.com/.test(html)) return 'Squarespace'
  if (/webflow/i.test(generator) || /assets\.website-files\.com/.test(html)) return 'Webflow'
  if (/drupal/i.test(generator)) return 'Drupal'
  if (/joomla/i.test(generator)) return 'Joomla'
  if (/__NEXT_DATA__/.test(html)) return 'Next.js'
  return 'Unknown'
}

/** HEAD the URL, falling back to GET — some servers reject HEAD outright. */
async function resourceExists(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return true
      // A definitive 404 needs no GET retry.
      if (res.status === 404) return false
    } catch {
      // try the next method
    }
  }
  return false
}

async function auditUrl(rawUrl: string) {
  let url = rawUrl.trim()
  if (!/^https?:\/\//.test(url)) url = 'https://' + url

  const t0 = Date.now()
  const resp = await fetch(url, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  })
  const loadMs = Date.now() - t0

  if (!resp.ok) {
    throw new Error(`Site returned ${resp.status} ${resp.statusText}`)
  }

  const html = await resp.text()
  const $ = cheerio.load(html)
  const finalUrl = resp.url || url
  const origin = new URL(finalUrl).origin

  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)

  // ── Title ──────────────────────────────────────────────
  const title = $('title').first().text().trim()
  add({
    key: 'title',
    label: 'Page Title',
    status: !title ? 'fail' : title.length < TITLE_MIN || title.length > TITLE_MAX ? 'warn' : 'pass',
    value: title ? `${title.length} chars — "${title.slice(0, 70)}${title.length > 70 ? '…' : ''}"` : 'Missing',
    impact: 'The clickable headline in Google results. Missing or truncated titles cost click-throughs.',
  })

  // ── Meta description ───────────────────────────────────
  const desc = ($('meta[name="description"]').attr('content') || '').trim()
  add({
    key: 'meta_description',
    label: 'Meta Description',
    status: !desc ? 'fail' : desc.length < DESC_MIN || desc.length > DESC_MAX ? 'warn' : 'pass',
    value: desc ? `${desc.length} chars` : 'Missing',
    impact: 'The sales pitch under your Google listing. Without it, Google scrapes random page text.',
  })

  // ── H1 ─────────────────────────────────────────────────
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean)
  add({
    key: 'h1',
    label: 'H1 Heading',
    status: h1s.length === 1 ? 'pass' : h1s.length === 0 ? 'fail' : 'warn',
    value: h1s.length === 0 ? 'None found' : h1s.length === 1 ? `"${h1s[0].slice(0, 60)}"` : `${h1s.length} H1 tags`,
    impact: 'Tells search engines the page topic. Exactly one H1 is the standard.',
  })

  // ── Canonical ──────────────────────────────────────────
  const canonical = $('link[rel="canonical"]').attr('href') || ''
  add({
    key: 'canonical',
    label: 'Canonical Tag',
    status: canonical ? 'pass' : 'warn',
    value: canonical || 'Missing',
    impact: 'Prevents duplicate-content penalties when the same page loads at several URLs.',
  })

  // ── Robots meta ────────────────────────────────────────
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase()
  const blocked = /noindex/.test(robotsMeta)
  add({
    key: 'robots_meta',
    label: 'Indexable',
    status: blocked ? 'fail' : 'pass',
    value: blocked ? 'noindex — hidden from Google' : robotsMeta || 'Indexable',
    impact: 'A stray noindex tag removes the page from Google entirely.',
  })

  // ── Open Graph ─────────────────────────────────────────
  const ogTitle = $('meta[property="og:title"]').attr('content') || ''
  const ogImage = $('meta[property="og:image"]').attr('content') || ''
  const ogDesc = $('meta[property="og:description"]').attr('content') || ''
  const ogCount = [ogTitle, ogImage, ogDesc].filter(Boolean).length
  add({
    key: 'open_graph',
    label: 'Social Preview (OG)',
    status: ogCount === 3 ? 'pass' : ogCount === 0 ? 'fail' : 'warn',
    value: ogCount === 0 ? 'Missing' : `${ogCount}/3 tags`,
    impact: 'Controls the image and text when the site is shared on Facebook, LinkedIn or WhatsApp.',
  })

  // ── Twitter card ───────────────────────────────────────
  const twitterCard = $('meta[name="twitter:card"]').attr('content') || ''
  add({
    key: 'twitter_card',
    label: 'Twitter Card',
    status: twitterCard ? 'pass' : 'warn',
    value: twitterCard || 'Missing',
    impact: 'Controls how links look when shared on X/Twitter.',
  })

  // ── Structured data ────────────────────────────────────
  const schemaTypes: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text())
      const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] ?? [parsed]
      for (const node of nodes) {
        const t = node?.['@type']
        if (typeof t === 'string') schemaTypes.push(t)
        else if (Array.isArray(t)) schemaTypes.push(...t.filter((x) => typeof x === 'string'))
      }
    } catch {
      // malformed JSON-LD blocks are ignored rather than failing the audit
    }
  })
  const uniqueSchema = [...new Set(schemaTypes)]
  add({
    key: 'schema',
    label: 'Schema Markup',
    status: uniqueSchema.length > 0 ? 'pass' : 'fail',
    value: uniqueSchema.length ? uniqueSchema.slice(0, 4).join(', ') : 'None',
    impact: 'Powers rich results — star ratings, FAQs, business hours. Without it you get a plain blue link.',
  })

  // ── Viewport / mobile ──────────────────────────────────
  const viewport = $('meta[name="viewport"]').attr('content') || ''
  add({
    key: 'viewport',
    label: 'Mobile Viewport',
    status: viewport ? 'pass' : 'fail',
    value: viewport ? 'Configured' : 'Missing',
    impact: 'Without it the site renders desktop-width on phones. Google indexes mobile-first.',
  })

  // ── HTTPS ──────────────────────────────────────────────
  const isHttps = finalUrl.startsWith('https://')
  add({
    key: 'https',
    label: 'HTTPS',
    status: isHttps ? 'pass' : 'fail',
    value: isHttps ? 'Secure' : 'Not secure',
    impact: 'Browsers flag non-HTTPS sites as "Not Secure", and it is a confirmed ranking signal.',
  })

  // ── Image alt text ─────────────────────────────────────
  const imgs = $('img')
  const imgTotal = imgs.length
  const imgWithAlt = imgs.filter((_, el) => ($(el).attr('alt') || '').trim().length > 0).length
  const altPct = imgTotal === 0 ? 100 : Math.round((imgWithAlt / imgTotal) * 100)
  add({
    key: 'image_alt',
    label: 'Image Alt Text',
    status: altPct >= 90 ? 'pass' : altPct >= 50 ? 'warn' : 'fail',
    value: imgTotal === 0 ? 'No images' : `${imgWithAlt}/${imgTotal} (${altPct}%)`,
    impact: 'Alt text drives Google Image traffic and is required for accessibility compliance.',
  })

  // ── Word count ─────────────────────────────────────────
  $('script, style, noscript').remove()
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const wordCount = bodyText ? bodyText.split(' ').length : 0
  add({
    key: 'word_count',
    label: 'Content Depth',
    status: wordCount >= 600 ? 'pass' : wordCount >= 250 ? 'warn' : 'fail',
    value: `${wordCount.toLocaleString()} words`,
    impact: 'Thin pages rarely rank. Competitors winning these keywords usually run 600+ words.',
  })

  // ── robots.txt & sitemap.xml ───────────────────────────
  const [hasRobots, hasSitemap] = await Promise.all([
    resourceExists(`${origin}/robots.txt`),
    resourceExists(`${origin}/sitemap.xml`),
  ])
  add({
    key: 'robots_txt',
    label: 'robots.txt',
    status: hasRobots ? 'pass' : 'warn',
    value: hasRobots ? 'Present' : 'Missing',
    impact: 'Tells search engines which pages to crawl and where the sitemap lives.',
  })
  add({
    key: 'sitemap',
    label: 'XML Sitemap',
    status: hasSitemap ? 'pass' : 'fail',
    value: hasSitemap ? 'Present' : 'Missing',
    impact: 'Without a sitemap Google has to guess your page list — new pages get indexed slowly or not at all.',
  })

  // ── Server response time ───────────────────────────────
  add({
    key: 'response_time',
    label: 'Server Response',
    status: loadMs < 800 ? 'pass' : loadMs < 2000 ? 'warn' : 'fail',
    value: `${(loadMs / 1000).toFixed(2)}s`,
    impact: 'Slow first-byte time delays every other thing the page has to do.',
  })

  // Weighted only by count — every check is a talking point on the call.
  const passed = checks.filter((c) => c.status === 'pass').length
  const warned = checks.filter((c) => c.status === 'warn').length
  const score = Math.round(((passed + warned * 0.5) / checks.length) * 100)

  return {
    url: finalUrl,
    score,
    cms: detectCms($, html),
    counts: {
      pass: passed,
      warn: warned,
      fail: checks.filter((c) => c.status === 'fail').length,
      total: checks.length,
    },
    checks,
  }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  console.log('[seo-audit] auditing:', url)
  try {
    const result = await auditUrl(url)
    return NextResponse.json(result)
  } catch (e: any) {
    const message =
      e?.name === 'TimeoutError' || /timeout/i.test(e?.message ?? '')
        ? 'The site took too long to respond.'
        : e?.message || 'Failed to audit site'
    console.error('[seo-audit] failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
