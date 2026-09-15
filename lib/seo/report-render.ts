/**
 * Rendering for the monthly client SEO report: the email body and the PDF.
 *
 * Deliberately client-facing in tone — the client sees what moved, what we
 * fixed, and what we're doing next. Internal things (issue keys, agent names,
 * check sources) stay out of here.
 */

import PDFDocument from 'pdfkit'
import type { SeoReportData, ReportScores } from '@/lib/seo/report'

const DARK       = '#0E0B24'
const ORANGE     = '#f97316'
const LIGHT_GRAY = '#94a3b8'
const WHITE      = '#ffffff'
const BODY       = '#1e293b'

const CATEGORY_LABEL: Record<string, string> = {
  technical: 'Technical',
  content:   'Content',
  gbp:       'Google Business Profile',
  backlinks: 'Backlinks',
  other:     'Other',
}

interface Metric {
  label: string
  current: number | null
  previous: number | null
}

/** The four headline numbers, in the order they're shown everywhere. */
export function metricsOf(data: SeoReportData): Metric[] {
  const cur  = data.current  ?? ({} as ReportScores)
  const prev = data.previous ?? ({} as ReportScores)
  return [
    { label: 'On-Page SEO',   current: cur.onpage  ?? null, previous: prev.onpage  ?? null },
    { label: 'Google SEO',    current: cur.psiSeo  ?? null, previous: prev.psiSeo  ?? null },
    { label: 'Speed',         current: cur.psiPerf ?? null, previous: prev.psiPerf ?? null },
    { label: 'Accessibility', current: cur.psiA11y ?? null, previous: prev.psiA11y ?? null },
  ]
}

function deltaText(m: Metric): string {
  if (m.current === null || m.previous === null) return ''
  const d = m.current - m.previous
  if (d === 0) return 'no change'
  return d > 0 ? `+${d} this month` : `${d} this month`
}

function scoreColor(score: number | null): string {
  if (score === null) return LIGHT_GRAY
  return score >= 70 ? '#16a34a' : score >= 50 ? ORANGE : '#dc2626'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Email ────────────────────────────────────────────────────────────────────

export function reportSubject(data: SeoReportData): string {
  return `${data.business} — SEO Report for ${data.periodLabel}`
}

/**
 * The email body. Self-contained (no images, no external CSS) so it renders the
 * same in Outlook as in Gmail, and readable even if the PDF never gets opened.
 */
export function reportEmailHtml(data: SeoReportData, commentary: string | null, agencyName: string): string {
  const metrics = metricsOf(data)

  const metricCells = metrics.map(m => `
    <td align="center" style="padding:12px 6px;">
      <div style="font-size:26px;font-weight:700;color:${scoreColor(m.current)};line-height:1;">
        ${m.current ?? '—'}
      </div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">${esc(m.label)}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${esc(deltaText(m))}</div>
    </td>`).join('')

  const fixedList = data.fixed.length
    ? `<ul style="margin:0;padding-left:18px;color:#475569;font-size:14px;line-height:1.7;">
         ${data.fixed.map(f => `<li>${esc(f.label)}</li>`).join('')}
       </ul>`
    : `<p style="font-size:14px;color:#64748b;margin:0;">No outstanding issues needed fixing this month — the site stayed clean.</p>`

  const taskList = data.tasks.length
    ? `<ul style="margin:0;padding-left:18px;color:#475569;font-size:14px;line-height:1.7;">
         ${data.tasks.map(t => `<li>${esc(t.title)} <span style="color:#94a3b8;">· ${esc(CATEGORY_LABEL[t.category] ?? t.category)}</span></li>`).join('')}
       </ul>`
    : ''

  const nextList = data.open.length
    ? `<ul style="margin:0;padding-left:18px;color:#475569;font-size:14px;line-height:1.7;">
         ${data.open.slice(0, 6).map(o => `<li>${esc(o.label)}</li>`).join('')}
       </ul>`
    : `<p style="font-size:14px;color:#64748b;margin:0;">Nothing outstanding — we're monitoring and will flag anything new.</p>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <div style="background:${DARK};padding:28px 32px;">
      <div style="color:${ORANGE};font-size:20px;font-weight:700;letter-spacing:-0.5px;">${esc(agencyName)}</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:4px;">SEO Report · ${esc(data.periodLabel)}</div>
    </div>

    <div style="padding:32px;">
      <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:16px;">
        Hi${data.contactName ? ' ' + esc(data.contactName) : ''},
      </div>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 20px;">
        Here's where <strong style="color:${ORANGE};">${esc(data.business)}</strong> stands after
        ${data.periodLabel}. We checked your site ${data.checksRun === 1 ? 'once' : `${data.checksRun} times`}
        this month.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;margin-bottom:24px;">
        <tr>${metricCells}</tr>
      </table>

      ${commentary ? `
      <div style="background:#fff7ed;border-left:3px solid ${ORANGE};padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:24px;">
        <p style="font-size:14px;color:#475569;line-height:1.6;margin:0;white-space:pre-line;">${esc(commentary)}</p>
      </div>` : ''}

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#0f172a;margin:0 0 10px;">What we fixed</h3>
      ${fixedList}

      ${taskList ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#0f172a;margin:24px 0 10px;">Work delivered</h3>
      ${taskList}` : ''}

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#0f172a;margin:24px 0 10px;">What we're working on next</h3>
      ${nextList}

      <p style="font-size:14px;color:#475569;line-height:1.6;margin:24px 0 0;">
        The full breakdown is attached as a PDF. Any questions, just reply to this email.
      </p>

      <p style="font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:20px;margin-top:24px;">
        ${esc(agencyName)} · ${esc(data.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── PDF ──────────────────────────────────────────────────────────────────────

type Doc = InstanceType<typeof PDFDocument>

function pdfHeader(doc: Doc, data: SeoReportData, agencyName: string) {
  doc.rect(0, 0, doc.page.width, 70).fill(DARK)
  doc.fillColor(ORANGE).fontSize(20).font('Helvetica-Bold').text(agencyName, 40, 18)
  doc.fillColor(WHITE).fontSize(9).font('Helvetica').text('Monthly SEO Report', 40, 44)
  doc.fillColor(LIGHT_GRAY).fontSize(9)
    .text(data.periodLabel, doc.page.width - 190, 30, { width: 150, align: 'right' })

  doc.rect(0, 70, doc.page.width, 55).fill('#160E32')
  doc.fillColor(WHITE).fontSize(15).font('Helvetica-Bold').text(data.business, 40, 84)
  doc.fillColor(ORANGE).fontSize(10).font('Helvetica')
    .text(data.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), 40, 105)

  doc.y = 145
}

function pdfSection(doc: Doc, text: string) {
  if (doc.y > doc.page.height - 140) doc.addPage()
  doc.moveDown(0.6)
  const y = doc.y
  doc.rect(40, y, doc.page.width - 80, 24).fill(DARK)
  doc.fillColor(ORANGE).fontSize(11).font('Helvetica-Bold')
    .text(text.toUpperCase(), 50, y + 7, { width: doc.page.width - 100 })
  doc.y = y + 34
  doc.fillColor(BODY).fontSize(10).font('Helvetica')
}

function pdfScoreRow(doc: Doc, data: SeoReportData) {
  const metrics = metricsOf(data)
  const boxW = (doc.page.width - 80 - 24) / 4
  const y = doc.y

  metrics.forEach((m, i) => {
    const x = 40 + i * (boxW + 8)
    doc.roundedRect(x, y, boxW, 64, 8).fill('#f8fafc')
    doc.fillColor(scoreColor(m.current)).fontSize(24).font('Helvetica-Bold')
      .text(m.current === null ? '—' : String(m.current), x, y + 10, { width: boxW, align: 'center' })
    doc.fillColor('#64748b').fontSize(8).font('Helvetica')
      .text(m.label, x, y + 40, { width: boxW, align: 'center' })
    const d = deltaText(m)
    if (d) {
      doc.fillColor(LIGHT_GRAY).fontSize(7).text(d, x, y + 51, { width: boxW, align: 'center' })
    }
  })

  doc.y = y + 78
  doc.fillColor(BODY).fontSize(10).font('Helvetica')
}

function pdfBullets(doc: Doc, items: string[], emptyText: string) {
  if (!items.length) {
    doc.fillColor('#64748b').fontSize(10).font('Helvetica-Oblique').text(emptyText, 50, doc.y, { width: doc.page.width - 100 })
    doc.font('Helvetica').fillColor(BODY)
    doc.moveDown(0.4)
    return
  }
  for (const item of items) {
    if (doc.y > doc.page.height - 70) doc.addPage()
    doc.fillColor(ORANGE).fontSize(10).text('•', 50, doc.y, { continued: false, width: 10 })
    doc.moveUp()
    doc.fillColor(BODY).fontSize(10).text(item, 64, doc.y, { width: doc.page.width - 124 })
    doc.moveDown(0.25)
  }
  doc.moveDown(0.3)
}

export async function buildSeoReportPDF(
  data: SeoReportData,
  commentary: string | null,
  agencyName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    pdfHeader(doc, data, agencyName)
    pdfScoreRow(doc, data)

    if (commentary) {
      pdfSection(doc, 'Summary')
      doc.fillColor(BODY).fontSize(10).font('Helvetica')
        .text(commentary, 50, doc.y, { width: doc.page.width - 100, lineGap: 2 })
      doc.moveDown(0.6)
    }

    pdfSection(doc, 'What we fixed this month')
    pdfBullets(
      doc,
      data.fixed.map(f => (f.impact ? `${f.label} — ${f.impact}` : f.label)),
      'No outstanding issues needed fixing this month.'
    )

    pdfSection(doc, 'Work delivered')
    pdfBullets(
      doc,
      data.tasks.map(t => `${t.title} (${CATEGORY_LABEL[t.category] ?? t.category})`),
      'No scheduled tasks were recorded for this period.'
    )

    pdfSection(doc, "What we're working on next")
    pdfBullets(
      doc,
      data.open.map(o => (o.impact ? `${o.label} — ${o.impact}` : o.label)),
      'Nothing outstanding. We continue to monitor the site.'
    )

    const { domainExpiry, sslExpiry, hostingExpiry } = data.health
    if (domainExpiry || sslExpiry || hostingExpiry) {
      pdfSection(doc, 'Site health')
      pdfBullets(doc, [
        domainExpiry  ? `Domain renews ${domainExpiry}`   : '',
        sslExpiry     ? `SSL certificate renews ${sslExpiry}` : '',
        hostingExpiry ? `Hosting renews ${hostingExpiry}` : '',
      ].filter(Boolean), '')
    }

    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.fontSize(8).fillColor(LIGHT_GRAY)
        .text(`Page ${i + 1} of ${range.count}  ·  ${agencyName}  ·  ${data.periodLabel}`,
          40, doc.page.height - 30, { width: doc.page.width - 80, align: 'center' })
    }

    doc.end()
  })
}
