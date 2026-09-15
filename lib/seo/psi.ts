/**
 * PageSpeed Insights — the Lighthouse half of an SEO check.
 *
 * Same call /api/pagespeed makes, extracted so the monitor cron can use it
 * server-side. PSI is slow (10–25s per URL) and rate-limited without a key, so
 * callers should expect failures and treat them as "no PSI data this run"
 * rather than a failed check: the on-page crawl is the part that must succeed.
 */

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export interface PsiResult {
  url: string
  scores: {
    performance: number
    seo: number
    accessibility: number
    bestPractices: number
  }
  metrics: Record<string, string>
  opportunities: { title: string; savings: string | null }[]
}

export async function fetchPageSpeed(rawUrl: string): Promise<PsiResult> {
  let normalized = rawUrl.trim()
  if (!/^https?:\/\//.test(normalized)) normalized = 'https://' + normalized

  const apiKey = process.env.PAGESPEED_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? ''
  const categories = ['performance', 'seo', 'accessibility', 'best-practices']
  const qs = [
    `url=${encodeURIComponent(normalized)}`,
    'strategy=mobile',
    ...categories.map(c => `category=${c}`),
    ...(apiKey ? [`key=${apiKey}`] : []),
  ].join('&')

  // PSI routinely takes 20s+ on a slow site; without a ceiling a single bad URL
  // can hold the whole nightly sweep open.
  const res = await fetch(`${PSI_URL}?${qs}`, { signal: AbortSignal.timeout(60_000) })

  if (!res.ok) {
    let message = `PageSpeed returned ${res.status}`
    try {
      const errJson = await res.json()
      message = errJson?.error?.message ?? errJson?.error ?? message
    } catch {
      message = (await res.text().catch(() => message)) || message
    }
    throw new Error(message)
  }

  const json   = await res.json()
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

  return {
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
  }
}
