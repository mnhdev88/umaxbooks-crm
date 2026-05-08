import { NextRequest, NextResponse } from 'next/server'

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  let normalized = url.trim()
  if (!/^https?:\/\//.test(normalized)) normalized = 'https://' + normalized

  const apiKey = process.env.PAGESPEED_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? ''
  const categories = ['performance', 'seo', 'accessibility', 'best-practices']
  const qs = [
    `url=${encodeURIComponent(normalized)}`,
    'strategy=mobile',
    ...categories.map(c => `category=${c}`),
    ...(apiKey ? [`key=${apiKey}`] : []),
  ].join('&')

  console.log('[pagespeed] fetching:', normalized)
  let res: Response
  try {
    res = await fetch(`${PSI_URL}?${qs}`)
  } catch (e: any) {
    console.error('[pagespeed] fetch failed:', e?.message)
    return NextResponse.json({ error: 'Failed to reach PageSpeed API' }, { status: 502 })
  }

  if (!res.ok) {
    let message = `PageSpeed returned ${res.status}`
    try {
      const errJson = await res.json()
      message = errJson?.error?.message ?? errJson?.error ?? message
    } catch {
      message = (await res.text().catch(() => message)) || message
    }
    console.error('[pagespeed]', res.status, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const json = await res.json()
  const cats   = json.lighthouseResult?.categories ?? {}
  const audits = json.lighthouseResult?.audits    ?? {}

  const score = (key: string) => Math.round((cats[key]?.score ?? 0) * 100)

  const opportunities = (Object.values(audits) as any[])
    .filter(a => a.score !== null && a.score < 0.9 && a.details?.type === 'opportunity')
    .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
    .slice(0, 5)
    .map(a => ({
      title: a.title as string,
      savings: a.details?.overallSavingsMs
        ? `${(a.details.overallSavingsMs / 1000).toFixed(1)}s savings`
        : null,
    }))

  return NextResponse.json({
    url: normalized,
    scores: {
      performance:   score('performance'),
      seo:           score('seo'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
    },
    metrics: {
      lcp:        audits['largest-contentful-paint']?.displayValue ?? 'N/A',
      fcp:        audits['first-contentful-paint']?.displayValue   ?? 'N/A',
      cls:        audits['cumulative-layout-shift']?.displayValue  ?? 'N/A',
      tbt:        audits['total-blocking-time']?.displayValue      ?? 'N/A',
      speedIndex: audits['speed-index']?.displayValue              ?? 'N/A',
      tti:        audits['interactive']?.displayValue              ?? 'N/A',
    },
    opportunities,
  })
}
