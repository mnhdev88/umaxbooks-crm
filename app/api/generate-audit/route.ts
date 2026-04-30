import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import { buildSummaryPDF, buildDetailedPDF } from '@/lib/audit-pdf'
import { getClientFolder, getFileName } from '@/lib/utils'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ── Scrape website data ──────────────────────────────────────────────────────
async function scrapeWebsite(rawUrl: string) {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  try {
    const t0 = Date.now()
    const resp = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    const loadMs = Date.now() - t0
    const html = await resp.text()
    const $ = cheerio.load(html)

    const allHrefs = $('a[href]').map((_, el) => $(el).attr('href') || '').get()
    const bodyText = $('body').text()

    return {
      url, hasSSL: url.startsWith('https://'), loadMs,
      title: $('title').text().trim(),
      metaDescription: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
      metaKeywords: $('meta[name="keywords"]').attr('content') || '',
      h1: $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean),
      h2: $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 6),
      socialLinks: {
        facebook: allHrefs.find(h => /facebook\.com\/(?!share)/.test(h)) || null,
        instagram: allHrefs.find(h => h.includes('instagram.com/')) || null,
        youtube: allHrefs.find(h => h.includes('youtube.com/')) || null,
        linkedin: allHrefs.find(h => h.includes('linkedin.com/')) || null,
      },
      phones: [...new Set((bodyText.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g) || []).slice(0, 3))],
      hasGoogleAnalytics: html.includes('google-analytics.com') || html.includes('gtag(') || html.includes('googletagmanager.com'),
      hasFacebookPixel: html.includes('fbq(') || html.includes('fbevents'),
      hasSchemaMarkup: html.includes('application/ld+json'),
      hasContactForm: $('form').length > 0,
      hasChat: html.includes('tawk.to') || html.includes('crisp.chat') || html.includes('intercom'),
      wordCount: bodyText.split(/\s+/).filter(Boolean).length,
      imageCount: $('img').length,
      imagesWithAlt: $('img[alt]').length,
      statusCode: resp.status,
    }
  } catch (e: any) {
    return { error: e.message, url: rawUrl }
  }
}

// ── Scrape GMB from Google ───────────────────────────────────────────────────
async function scrapeGMB(businessName: string, city: string) {
  try {
    const query = encodeURIComponent(`${businessName} ${city}`.trim())
    const resp = await fetch(`https://www.google.com/search?q=${query}&hl=en`, {
      headers: HEADERS, signal: AbortSignal.timeout(10000),
    })
    const $ = cheerio.load(await resp.text())
    const jsonLds: any[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
      try { jsonLds.push(JSON.parse($(el).html() || '')) } catch {}
    })
    const biz = jsonLds.find(d => d['@type'] && /LocalBusiness|Restaurant|Store|Service/.test(JSON.stringify(d['@type'])))
    if (!biz) return null
    return {
      rating: biz.aggregateRating?.ratingValue || null,
      reviewCount: biz.aggregateRating?.reviewCount || null,
      address: biz.address ? [biz.address.streetAddress, biz.address.addressLocality, biz.address.addressRegion].filter(Boolean).join(', ') : null,
      phone: biz.telephone || null,
      hours: Array.isArray(biz.openingHours) ? biz.openingHours : biz.openingHours ? [biz.openingHours] : [],
      categories: Array.isArray(biz['@type']) ? biz['@type'].join(', ') : biz['@type'],
    }
  } catch { return null }
}

// ── Build Claude prompt ──────────────────────────────────────────────────────
function buildPrompt(type: 'summary' | 'detailed', businessName: string, city: string, website: any, gmb: any) {
  const w = website
  const g = gmb

  const websiteSection = w?.error ? `Website scrape failed: ${w.error}` : `
Title: ${w.title || 'MISSING'}
Meta Description: ${w.metaDescription || 'MISSING'} (${w.metaDescription ? w.metaDescription.length + ' chars' : 'none'})
Meta Keywords: ${w.metaKeywords || 'none'}
SSL/HTTPS: ${w.hasSSL ? 'Yes ✓' : 'No ✗'}
Page Load Time: ${w.loadMs}ms (${w.loadMs < 2000 ? 'Good' : w.loadMs < 4000 ? 'Needs Improvement' : 'Poor'})
H1 Tags: ${w.h1?.length ? w.h1.join(' | ') : 'MISSING'}
H2 Tags: ${w.h2?.length ? w.h2.join(' | ') : 'None found'}
Word Count: ${w.wordCount} (${w.wordCount > 300 ? 'Good' : 'Too thin'})
Images: ${w.imageCount} total, ${w.imagesWithAlt} with alt text
Google Analytics: ${w.hasGoogleAnalytics ? 'Installed ✓' : 'Not found ✗'}
Facebook Pixel: ${w.hasFacebookPixel ? 'Installed ✓' : 'Not found ✗'}
Schema Markup: ${w.hasSchemaMarkup ? 'Present ✓' : 'Missing ✗'}
Contact Form: ${w.hasContactForm ? 'Yes ✓' : 'No ✗'}
Live Chat: ${w.hasChat ? 'Yes ✓' : 'No ✗'}
Social Links Found: ${Object.entries(w.socialLinks || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'}
Phone on page: ${w.phones?.length ? w.phones.join(', ') : 'Not found ✗'}
HTTP Status: ${w.statusCode}`

  const gmbSection = g ? `
Rating: ${g.rating || 'Unknown'}/5
Review Count: ${g.reviewCount || 'Unknown'}
Address: ${g.address || 'Not found'}
Phone: ${g.phone || 'Not found'}
Categories: ${g.categories || 'Unknown'}
Business Hours Listed: ${g.hours?.length ? g.hours.join(', ') : 'Not found'}` : 'GMB data unavailable'

  if (type === 'summary') {
    return `You are a professional SEO consultant at a digital marketing agency. Write a concise SEO audit summary report.

BUSINESS: ${businessName}
LOCATION: ${city}
WEBSITE: ${w?.url || 'N/A'}
DATE: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

=== WEBSITE DATA ===
${websiteSection}

=== GOOGLE MY BUSINESS ===
${gmbSection}

Write a professional 1-2 page SEO summary using this exact format:

## Executive Summary
[2-3 sentences summarizing the current SEO state and main opportunity]

## Overall SEO Score
SCORE: [number between 0-100 based on the data]
[2-3 sentences explaining the score]

## Critical Issues
- [Issue 1 with specific detail from the data]
- [Issue 2]
- [Issue 3]
- [Issue 4 if applicable]

## Quick Wins (Immediate Actions)
- [Specific actionable fix #1 — what exactly to do]
- [Specific actionable fix #2]
- [Specific actionable fix #3]

## Key Metrics Snapshot
- Page Load: ${w?.loadMs || 'N/A'}ms
- SSL: ${w?.hasSSL ? 'Active' : 'Missing'}
- GMB Rating: ${g?.rating || 'N/A'}/5 (${g?.reviewCount || '?'} reviews)
- Schema Markup: ${w?.hasSchemaMarkup ? 'Present' : 'Missing'}
- Analytics: ${w?.hasGoogleAnalytics ? 'Installed' : 'Missing'}

Use professional language. Be specific — mention actual data points. Do not include generic filler content.`
  }

  return `You are a senior SEO consultant at a digital marketing agency. Write a comprehensive SEO audit report.

BUSINESS: ${businessName}
LOCATION: ${city}
WEBSITE: ${w?.url || 'N/A'}
DATE: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

=== WEBSITE DATA ===
${websiteSection}

=== GOOGLE MY BUSINESS ===
${gmbSection}

Write a detailed professional SEO audit using this exact structure:

## Executive Summary
[3-4 sentences. Current state, main strengths, critical gaps, main opportunity.]

## SEO Score Breakdown
SCORE: [number 0-100]
- Technical SEO: [score]/25
- On-Page SEO: [score]/25
- Local SEO: [score]/25
- Analytics & Tracking: [score]/25
[Brief explanation of each]

## Technical SEO Analysis
### Page Speed & Performance
[Analysis of ${w?.loadMs || '?'}ms load time, what it means, impact]

### Security
[SSL analysis, HTTPS status, what it means for rankings]

### Schema Markup
[Current status, what schemas are present/missing, recommendation]

### Crawlability & Indexing
[Analysis based on available data]

## On-Page SEO Analysis
### Title Tag
[Analysis of: "${w?.title || 'Not found'}"]
[Length assessment, keyword presence, recommendations]

### Meta Description
[Analysis of: "${w?.metaDescription?.slice(0, 80) || 'Missing'}..."]
[Length, CTR impact, recommendations]

### Heading Structure
[H1: ${w?.h1?.[0] || 'Missing'} — analysis]
[H2 structure analysis]

### Content Analysis
[Word count ${w?.wordCount || '?'}, quality assessment, recommendations]

### Image Optimization
[${w?.imageCount || '?'} images, ${w?.imagesWithAlt || '?'} with alt text — analysis]

## Local SEO & Google My Business
### GMB Profile Analysis
[Rating ${g?.rating || 'unknown'}, reviews ${g?.reviewCount || 'unknown'} — analysis and benchmarks]

### Local Citations & NAP Consistency
[Phone visibility: ${w?.phones?.length ? 'Found on website' : 'Not visible on website'}, recommendations]

### Local Schema Markup
[LocalBusiness schema status and recommendations]

## Analytics & Tracking
### Google Analytics
[Status: ${w?.hasGoogleAnalytics ? 'Installed' : 'Not Found'} — impact and recommendations]

### Facebook Pixel
[Status: ${w?.hasFacebookPixel ? 'Installed' : 'Not Found'} — impact and recommendations]

### Conversion Tracking
[Contact form: ${w?.hasContactForm ? 'Present' : 'Missing'}, chat: ${w?.hasChat ? 'Present' : 'Missing'}]

## Social Media Presence
[Analysis of social profiles found: ${Object.entries(w?.socialLinks || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None found'}]

## Prioritized Recommendations
List exactly 15 specific, actionable recommendations numbered 1-15, ordered by impact:
1. [Most critical — specific action, expected impact]
2. [Next most critical]
...continue to 15

## 90-Day Action Plan
### Month 1 (Quick Wins)
- [3-4 specific tasks]

### Month 2 (Core Improvements)
- [3-4 specific tasks]

### Month 3 (Growth & Optimization)
- [3-4 specific tasks]

Be specific, professional, and data-driven. Reference actual numbers from the audit data.`
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in .env.local' }, { status: 500 })
  }

  const { leadId, leadSlug, userId, websiteUrl, businessName, city } = await req.json()
  if (!leadId || !userId) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const ai = new Anthropic({ apiKey })
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // ── Step 1: Scrape ─────────────────────────────────────────────────────────
  const [website, gmb] = await Promise.allSettled([
    websiteUrl ? scrapeWebsite(websiteUrl) : Promise.resolve(null),
    businessName ? scrapeGMB(businessName, city || '') : Promise.resolve(null),
  ])
  const websiteData = website.status === 'fulfilled' ? website.value : null
  const gmbData = gmb.status === 'fulfilled' ? gmb.value : null

  // ── Step 2: Generate AI content ────────────────────────────────────────────
  const [summaryRes, detailedRes] = await Promise.allSettled([
    ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildPrompt('summary', businessName || 'Business', city || '', websiteData, gmbData) }],
    }),
    ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{ role: 'user', content: buildPrompt('detailed', businessName || 'Business', city || '', websiteData, gmbData) }],
    }),
  ])

  if (summaryRes.status === 'rejected') {
    return NextResponse.json({ error: `Claude API error: ${summaryRes.reason?.message}` }, { status: 500 })
  }
  if (detailedRes.status === 'rejected') {
    return NextResponse.json({ error: `Claude API error: ${detailedRes.reason?.message}` }, { status: 500 })
  }

  const summaryText = (summaryRes.value.content[0] as any).text as string
  const detailedText = (detailedRes.value.content[0] as any).text as string

  // Extract score from summary
  const scoreMatch = summaryText.match(/SCORE:\s*(\d+)/)
  const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 60

  // ── Step 3: Generate PDFs ──────────────────────────────────────────────────
  const biz = `${businessName || 'Business'} – ${city || ''}`
  const [shortPdf, longPdf] = await Promise.all([
    buildSummaryPDF(businessName || 'Business', city || '', score, summaryText, date),
    buildDetailedPDF(businessName || 'Business', city || '', score, detailedText, date),
  ])

  // ── Step 4: Upload PDFs ────────────────────────────────────────────────────
  const folder = getClientFolder(leadSlug || leadId)
  const version = `v${Date.now()}`
  const shortName = getFileName('audit-short', leadSlug || leadId, version, 'pdf')
  const longName = getFileName('audit-long', leadSlug || leadId, version, 'pdf')

  const [shortUpload, longUpload] = await Promise.all([
    admin.storage.from('crm-files').upload(`${folder}/audits/${shortName}`, shortPdf, {
      contentType: 'application/pdf', upsert: true,
    }),
    admin.storage.from('crm-files').upload(`${folder}/audits/${longName}`, longPdf, {
      contentType: 'application/pdf', upsert: true,
    }),
  ])

  const { data: shortUrl } = admin.storage.from('crm-files').getPublicUrl(shortUpload.data?.path || '')
  const { data: longUrl } = admin.storage.from('crm-files').getPublicUrl(longUpload.data?.path || '')

  // ── Step 5: Create audit record ────────────────────────────────────────────
  const now = new Date().toISOString()
  const { error: auditErr } = await admin.from('audits').insert({
    lead_id: leadId,
    created_by: userId,
    audit_short_pdf_url: shortUrl.publicUrl,
    audit_long_pdf_url: longUrl.publicUrl,
    short_uploaded_at: now,
    long_uploaded_at: now,
    short_uploaded_by: userId,
    long_uploaded_by: userId,
    score,
    scrape_data: { website: websiteData, gmb: gmbData },
  })

  if (auditErr) {
    return NextResponse.json({ error: `Audit record error: ${auditErr.message}` }, { status: 500 })
  }

  // ── Step 6: Log activity ───────────────────────────────────────────────────
  await admin.from('activity_logs').insert({
    lead_id: leadId,
    user_id: userId,
    action: 'AI Audit Generated',
    details: `SEO audit generated by Claude AI (Score: ${score}/100)`,
  })

  return NextResponse.json({
    success: true,
    score,
    shortUrl: shortUrl.publicUrl,
    longUrl: longUrl.publicUrl,
  })
}
