import { NextRequest, NextResponse } from 'next/server'
import { fetchPageSpeed } from '@/lib/seo/psi'

// The PSI call lives in lib/seo/psi.ts so the SEO monitor cron shares it.

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  console.log('[pagespeed] fetching:', url)
  try {
    return NextResponse.json(await fetchPageSpeed(url))
  } catch (e: any) {
    const message = e?.message || 'Failed to reach PageSpeed API'
    console.error('[pagespeed] failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
