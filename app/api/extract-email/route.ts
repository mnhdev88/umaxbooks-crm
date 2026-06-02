import { NextRequest, NextResponse } from 'next/server'

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

// Domains that appear in HTML/JS but are never real contact emails
const JUNK_DOMAINS = new Set([
  'example.com', 'test.com', 'sentry.io', 'w3.org', 'schema.org',
  'googleapis.com', 'google.com', 'facebook.com', 'apple.com',
  'microsoft.com', 'amazonaws.com', 'cloudflare.com', 'wordpress.org',
  'wixpress.com', 'squarespace.com', 'shopify.com',
])

const JUNK_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce', 'mailer-daemon']

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

  // High-value prefixes (likely the main business contact)
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
    const text = await res.text()
    return text
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
    if (results.has(email)) continue // already found via mailto
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

export async function POST(req: NextRequest) {
  const { websiteUrl } = await req.json()
  if (!websiteUrl) return NextResponse.json({ error: 'websiteUrl is required' }, { status: 400 })

  const base = normaliseBase(websiteUrl)
  if (!base) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })

  // Fetch these pages in parallel — contact pages first (higher priority)
  const pageSlugs = ['/contact', '/contact-us', '/about', '/about-us', '/']
  const pages = pageSlugs.map(slug => ({ slug, url: base + slug }))

  const htmlResults = await Promise.all(
    pages.map(async p => ({ slug: p.slug, html: await fetchPage(p.url) }))
  )

  // Collect and rank all found emails across all pages
  const allCandidates: Map<string, number> = new Map()
  for (const { slug, html } of htmlResults) {
    if (!html) continue
    for (const { email, score } of extractEmails(html, slug)) {
      allCandidates.set(email, Math.max(allCandidates.get(email) ?? 0, score))
    }
  }

  if (allCandidates.size === 0) {
    return NextResponse.json({ email: null, message: 'No email found on this website' })
  }

  const ranked = Array.from(allCandidates.entries())
    .sort((a, b) => b[1] - a[1])

  return NextResponse.json({ email: ranked[0][0] })
}
