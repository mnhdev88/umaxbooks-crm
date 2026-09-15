/**
 * Deliver a monthly SEO report to the client.
 *
 * Shared by the "Send" button and the auto-send sweep so both produce an
 * identical email, mark the report the same way, and respect the same blocks.
 *
 * The kill switch is NOT checked here: this function is called from a human
 * pressing Send as well as from the cron. The cron checks automatedEmailEnabled()
 * before it calls this — see lib/automated-email.ts for why that split exists.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { buildSeoReportPDF, reportEmailHtml, reportSubject } from '@/lib/seo/report-render'
import type { SeoReportData } from '@/lib/seo/report'

export type SendReportResult =
  | { ok: true; to: string }
  | { ok: false; error: string; status: number }

export async function sendSeoReport(
  service: SupabaseClient,
  reportId: string,
  opts: { to?: string | null; commentary?: string | null; sentBy?: string | null } = {}
): Promise<SendReportResult> {
  const { data: report } = await service
    .from('seo_reports')
    .select('id, site_id, lead_id, period_start, data, commentary, status')
    .eq('id', reportId)
    .maybeSingle()

  if (!report) return { ok: false, error: 'Report not found', status: 404 }
  if (report.status === 'sent') return { ok: false, error: 'This report has already been sent.', status: 409 }

  const [{ data: site }, { data: lead }] = await Promise.all([
    service.from('live_sites').select('seo_report_email').eq('id', report.site_id).maybeSingle(),
    service.from('leads').select('email, email_unsubscribed, company_name, name').eq('id', report.lead_id).maybeSingle(),
  ])

  // A dedicated reporting contact beats the sales contact when one is set —
  // the person who reads SEO reports often isn't the person who signed.
  const to = (opts.to || site?.seo_report_email || lead?.email || '').trim()
  if (!to) return { ok: false, error: 'No recipient email on this client.', status: 400 }

  if (lead?.email_unsubscribed && to === lead.email) {
    return { ok: false, error: 'This client has unsubscribed from emails.', status: 403 }
  }

  const commentary = opts.commentary ?? report.commentary ?? null
  const data = report.data as SeoReportData
  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Noveliotech'

  let pdf: Buffer | null = null
  try {
    pdf = await buildSeoReportPDF(data, commentary, agencyName)
  } catch (e: any) {
    // The email alone is a complete report; losing the PDF shouldn't block it.
    console.error('[seo-report] PDF build failed, sending without attachment:', e?.message)
  }

  const subject = reportSubject(data)
  const html    = reportEmailHtml(data, commentary, agencyName)

  const { error } = await sendEmail({
    to,
    subject,
    html,
    attachments: pdf
      ? [{ filename: `SEO-Report-${data.periodLabel.replace(/\s+/g, '-')}.pdf`, content: pdf }]
      : undefined,
  })

  if (error) return { ok: false, error, status: 502 }

  await service
    .from('seo_reports')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_to: to,
      sent_by: opts.sentBy ?? null,
      commentary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  // Best-effort trail on the lead's timeline. activity_logs.user_id is NOT NULL,
  // so an unattended auto-send has no row to write — seo_reports.sent_at is the
  // record of truth for those.
  if (opts.sentBy) {
    const { error: logError } = await service.from('activity_logs').insert({
      lead_id: report.lead_id,
      user_id: opts.sentBy,
      action: 'SEO Report Sent',
      details: `To: ${to} · ${data.periodLabel}`,
    })
    if (logError) console.error('[seo-report] activity log failed:', logError.message)
  }

  return { ok: true, to }
}
