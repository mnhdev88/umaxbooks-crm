import { NextRequest, NextResponse } from 'next/server'

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

// Domains that appear in HTML/JS but are never real contact emails
const JUNK_DOMAINS = new Set([
  'example.com', 'test.com', 'sentry.io', 'w3.org', 'schema.org',
  'googleapis.com', 'google.com', 'facebook.com', 'apple.com',
  'microsoft.com', 'amazonaws.com', 'cloudflare.com', 'wordpress.org',
  'wixpress.com', 'squarespace.com', 'shopify.com', 'duckduckgo.com',
  'bing.com', 'yahoo.com',
])

const JUNK_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce', 'mailer-daemon', 'postmaster']

function scoreEmail(email: string, source: 'mailto' | 'text', page: string): number {
  const [local, domain] = email.toLowerCase().split('@')
  if (!local || !domain) return -1
  if (JUNK_DOMAINS.has(domain)) return -1
  if (JUNK_PREFIXES.some(p => local.startsWith(p))) return -1
  if (domain.split('.').some(part => part.length > 63)) return -1

  let score = 0
  if (source === 'mailto') score += 30
  if (page.includes('contact')) score += 20
  if (page.includes('about'))   score += 10

  const GOOD = ['info', 'contact', 'hello', 'hi', 'office', 'admin', 'enquiry', 'enquiries', 'inquiry', 'support', 'sales', 'team']
  if (GOOD.some(p => local === p || local.startsWith(p + '.'))) score += 25

  return score
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CRM-EmailFinder/1.0)' },
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

function extractEmails(html: string, page: string): { email: string; score: number }[] {
  const results: Map<string, number> = new Map()

  // 1. mailto: links (most reliable)
  const mailtoMatches = html.matchAll(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi)
  for (const m of mailtoMatches) {
    const email = m[1].toLowerCase()
    const score = scoreEmail(email, 'mailto', page)
    if (score >= 0) results.set(email, Math.max(results.get(email) ?? 0, score))
  }

  // 2. Plain text email patterns
  const textMatches = html.matchAll(EMAIL_REGEX)
  for (const m of textMatches) {
    const email = m[0].toLowerCase()
    if (results.has(email)) continue
    const score = scoreEmail(email, 'text', page)
    if (score >= 0) results.set(email, Math.max(results.get(email) ?? 0, score))
  }

  return Array.from(results.entries())
    .map(([email, score]) => ({ email, score }))
    .sort((a, b) => b.score - a.score)
}

function normaliseBase(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

// ── Website scrape ──────────────────────────────────────────────────────────
async function scrapeWebsite(websiteUrl: string): Promise<string | null> {
  const base = normaliseBase(websiteUrl)
  if (!base) return null

  const pageSlugs = ['/contact', '/contact-us', '/about', '/about-us', '/']
  const htmlResults = await Promise.all(
    pageSlugs.map(async slug => ({ slug, html: await fetchPage(base + slug) }))
  )

  const allCandidates: Map<string, number> = new Map()
  for (const { slug, html } of htmlResults) {
    if (!html) continue
    for (const { email, score } of extractEmails(html, slug)) {
      allCandidates.set(email, Math.max(allCandidates.get(email) ?? 0, score))
    }
  }

  if (allCandidates.size === 0) return null

  const ranked = Array.from(allCandidates.entries()).sort((a, b) => b[1] - a[1])
  return ranked[0][0]
}

// ── DuckDuckGo search scrape ────────────────────────────────────────────────
async function scrapeSearchResults(companyName: string, city: string): Promise<string | null> {
  const query = `"${companyName}" ${city} contact email`
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html   = await fetchPage(ddgUrl)
  if (!html) return null

  // Extract emails from search result snippets only (between <a and </a> tags)
  // This avoids picking up emails from DDG's own UI chrome
  const snippetMatches = html.match(/<a[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/a>/gi) || []
  const snippetText    = snippetMatches.join(' ')

  const candidates = extractEmails(snippetText.length > 100 ? snippetText : html, 'search')
  return candidates[0]?.email ?? null
}

// ── Handler ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { websiteUrl, companyName, city = '' } = await req.json()

  if (!websiteUrl && !companyName) {
    return NextResponse.json({ error: 'Provide websiteUrl or companyName' }, { status: 400 })
  }

  // Always build a Google search URL as the last-resort fallback for the client
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${companyName || ''}" ${city} contact email`.trim())}`

  // Path 1: website URL available — scrape pages directly
  if (websiteUrl) {
    const email = await scrapeWebsite(websiteUrl)
    if (email) return NextResponse.json({ email, source: 'website' })

    // Website scraped but nothing found — try DuckDuckGo if we have a company name
    if (companyName) {
      const ddgEmail = await scrapeSearchResults(companyName, city)
      if (ddgEmail) return NextResponse.json({ email: ddgEmail, source: 'search' })
    }

    return NextResponse.json({ email: null, googleSearchUrl })
  }

  // Path 2: no website — go straight to DuckDuckGo
  const ddgEmail = await scrapeSearchResults(companyName, city)
  if (ddgEmail) return NextResponse.json({ email: ddgEmail, source: 'search' })

  return NextResponse.json({ email: null, googleSearchUrl })
}
