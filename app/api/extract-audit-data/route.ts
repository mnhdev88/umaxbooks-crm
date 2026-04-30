import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const auditId = formData.get('auditId') as string | null

  if (!file || !auditId) {
    return NextResponse.json({ error: 'Missing file or auditId' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const ai = new Anthropic({ apiKey })
  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        } as any,
        {
          type: 'text',
          text: `Extract SEO metrics from this audit report. Return ONLY raw JSON — no markdown fences, no explanation. Use null for any field not found in the report.

{
  "score": <overall SEO score 0-100 or null>,
  "loadMs": <page load time in milliseconds or null>,
  "wordCount": <word count or null>,
  "hasSSL": <true/false/null>,
  "hasGoogleAnalytics": <true/false/null>,
  "hasFacebookPixel": <true/false/null>,
  "hasSchemaMarkup": <true/false/null>,
  "hasContactForm": <true/false/null>,
  "hasChat": <true/false/null>,
  "imageCount": <total images or null>,
  "imagesWithAlt": <images with alt text or null>,
  "gmbRating": <Google My Business star rating or null>,
  "gmbReviewCount": <number of GMB reviews or null>
}`,
        },
      ],
    }],
  })

  try {
    const raw = (response.content[0] as any).text as string
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonStr) return NextResponse.json({ success: false })

    const e = JSON.parse(jsonStr)

    const scrapeData = {
      website: {
        hasSSL: e.hasSSL ?? null,
        loadMs: e.loadMs ?? null,
        wordCount: e.wordCount ?? null,
        hasGoogleAnalytics: e.hasGoogleAnalytics ?? null,
        hasFacebookPixel: e.hasFacebookPixel ?? null,
        hasSchemaMarkup: e.hasSchemaMarkup ?? null,
        hasContactForm: e.hasContactForm ?? null,
        hasChat: e.hasChat ?? null,
        imageCount: e.imageCount ?? null,
        imagesWithAlt: e.imagesWithAlt ?? null,
      },
      gmb: {
        rating: e.gmbRating ?? null,
        reviewCount: e.gmbReviewCount ?? null,
      },
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    await admin.from('audits')
      .update({ score: e.score ?? null, scrape_data: scrapeData })
      .eq('id', auditId)

    return NextResponse.json({ success: true, score: e.score ?? null })
  } catch {
    return NextResponse.json({ success: false })
  }
}
