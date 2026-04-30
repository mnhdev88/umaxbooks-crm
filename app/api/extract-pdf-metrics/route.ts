import { NextRequest, NextResponse } from 'next/server'
import { extractText } from 'unpdf'

// Fixed after-values and business impact — same for every client
const FIXED_METRICS = [
  { metric_name: 'PageSpeed — Mobile',    after_value: '89 / 100',                business_impact: '53% of mobile visitors leave slow sites. Fixed.' },
  { metric_name: 'Local keywords ranked', after_value: '14 keywords',              business_impact: '3× more search visibility for local searches.' },
  { metric_name: 'Schema markup',         after_value: 'LocalBusiness + FAQPage',  business_impact: 'Enables star ratings and address in Google search.' },
  { metric_name: 'Mobile CTA',            after_value: 'Sticky Book Now button',   business_impact: 'CTAs above fold improve conversions by 40%+.' },
  { metric_name: 'GMB consistency',       after_value: 'Fully synced',             business_impact: 'Top local SEO ranking signal — now working for them.' },
  { metric_name: 'PageSpeed — Desktop',   after_value: '96 / 100',                business_impact: 'Better UX across all devices. Lower bounce rate.' },
]

// Extract BEFORE values from audit PDF text
function extractBeforeValues(text: string): Record<string, string> {
  const r: Record<string, string> = {}

  // ── PageSpeed Mobile ────────────────────────────────────────────────
  // Try explicit score first (e.g. "Mobile: 54/100" or "54 / 100")
  const mobileScore =
    text.match(/mobile[^.\n]{0,80}?(\d{2,3})\s*\/\s*100/i) ||
    text.match(/pagespeed[^.\n]{0,50}?(\d{2,3})\s*\/\s*100/i)
  if (mobileScore) {
    r['PageSpeed — Mobile'] = `${mobileScore[1]} / 100`
  } else {
    // Fall back to load time from Key Metrics Snapshot
    const loadMs = text.match(/page\s+load[:\s]+(\d[\d,]+)\s*ms/i)
    if (loadMs) r['PageSpeed — Mobile'] = `${loadMs[1]}ms load time`
  }

  // ── PageSpeed Desktop ───────────────────────────────────────────────
  const desktopScore =
    text.match(/desktop[^.\n]{0,80}?(\d{2,3})\s*\/\s*100/i)
  if (desktopScore) r['PageSpeed — Desktop'] = `${desktopScore[1]} / 100`

  // ── Local keywords ranked ───────────────────────────────────────────
  const kwMatch =
    text.match(/(\d+)\s+(?:local\s+)?keywords?\s+(?:ranked|tracked|found|appear)/i) ||
    text.match(/ranking[^.\n]{0,40}?(\d+)\s+keywords?/i) ||
    text.match(/(\d+)\s+keywords?\s+(?:in|on)\s+(?:google|search)/i)
  if (kwMatch) r['Local keywords ranked'] = `${kwMatch[1]} keywords`

  // ── Schema markup ───────────────────────────────────────────────────
  if (/schema\s+markup[:\s]+missing/i.test(text) ||
      /schema[^.\n]{0,30}?not\s+(?:detected|found|present|installed)/i.test(text) ||
      /schema[:\s]+none/i.test(text)) {
    r['Schema markup'] = 'None'
  } else if (/schema\s+markup[:\s]+present/i.test(text) ||
             /schema[^.\n]{0,30}?(?:detected|found|present|installed)/i.test(text)) {
    r['Schema markup'] = 'Present'
  }

  // ── Mobile CTA ──────────────────────────────────────────────────────
  if (/cta[^.\n]{0,80}?(?:hidden|below\s+fold|not\s+visible|missing)/i.test(text) ||
      /(?:no|missing)\s+(?:clear\s+)?(?:cta|call.to.action)/i.test(text) ||
      /call.to.action[^.\n]{0,60}?(?:hidden|missing|not\s+visible|below\s+fold)/i.test(text)) {
    r['Mobile CTA'] = 'Hidden below fold'
  }

  // ── GMB consistency ─────────────────────────────────────────────────
  const gmbMismatch =
    text.match(/(\d+)\s+(?:field|gmb|nap)\s+(?:mismatch|inconsisten)/i) ||
    text.match(/gmb[^.\n]{0,100}?(\d+)\s+(?:mismatch|inconsisten|discrepanc|issue|error)/i) ||
    text.match(/(\d+)\s+(?:mismatch|inconsisten)[^.\n]{0,40}?(?:gmb|google\s+business|nap)/i)
  if (gmbMismatch) {
    const n = parseInt(gmbMismatch[1])
    r['GMB consistency'] = `${n} field mismatch${n !== 1 ? 'es' : ''}`
  }

  return r
}

function parseSummary(text: string): string {
  const m = text.match(/(?:executive\s+summary)[:\s\n]+([^\n]{20,}(?:\n(?=[^\n]{5,})[^\n]+){0,4})/i)
  if (m) return m[1].replace(/\n/g, ' ').trim()
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 60)
  return paras[1] || paras[0] || ''
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())

    let text: string
    try {
      const result = await extractText(new Uint8Array(buffer), { mergePages: true })
      text = result.text as string
    } catch (e: any) {
      return NextResponse.json({ error: `Could not read PDF: ${e.message}` }, { status: 422 })
    }

    if (!text?.trim()) {
      return NextResponse.json(
        { error: 'PDF has no selectable text (may be a scanned image).' },
        { status: 422 }
      )
    }

    const beforeValues = extractBeforeValues(text)

    // Build the 6 fixed metric rows, filling in before values where found
    const metrics = FIXED_METRICS.map((m, i) => ({
      metric_name:    m.metric_name,
      before_value:   beforeValues[m.metric_name] || '',
      after_value:    m.after_value,
      business_impact: m.business_impact,
      sort_order:     i,
    }))

    const developer_summary = parseSummary(text)

    return NextResponse.json({ metrics, developer_summary })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Extraction failed' }, { status: 500 })
  }
}
