import { NextRequest, NextResponse } from 'next/server'
import { auditUrl } from '@/lib/seo/crawl'

// The checks themselves live in lib/seo/crawl.ts so the SEO monitor cron can run
// the same audit without calling back into this route over HTTP.

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
