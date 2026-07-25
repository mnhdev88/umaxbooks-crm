import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { automatedEmailEnabled } from '@/lib/automated-email'
import { buildDialerReport, dialerReportToCSV, dialerSummaryHtml } from '@/lib/dialer-report'

// End-of-day per-sales-agent dialer-call report. Designed to run at 4:30 AM, so
// it reports the calendar day that just ended (YESTERDAY, in server-local time).
// Emails all admins a summary table with the full per-call detail attached as CSV.
//
// vercel.json crons DON'T fire on the EC2/PM2 deploy — trigger via server crontab:
//   30 4 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/eod-dialer-report
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Automated email paused in Settings — skip the whole report rather than build one
  // nobody receives. Reports → Call Performance still shows the same numbers live.
  if (!(await automatedEmailEnabled())) {
    return NextResponse.json({ ok: true, paused: true, sent: 0, message: 'Automated email is turned off' })
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Yesterday's [midnight, midnight) in server-local time.
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const fromISO = startOfYesterday.toISOString()
  const toISO = startOfToday.toISOString()
  const label = startOfYesterday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  let report
  try {
    report = await buildDialerReport(service, { fromISO, toISO, label })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }

  // Recipients: all admins with an email on file.
  const { data: admins } = await service
    .from('profiles')
    .select('email')
    .eq('role', 'admin')
    .not('email', 'is', null)

  const recipients = [...new Set((admins ?? []).map(a => a.email).filter(Boolean))] as string[]
  if (!recipients.length) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No admin recipients' })
  }

  const csv = dialerReportToCSV(report)
  const attachments = [{
    filename: `dialer-calls_${startOfYesterday.toISOString().slice(0, 10)}.csv`,
    content: Buffer.from('﻿' + csv, 'utf-8'), // BOM for Excel
  }]
  const html = dialerSummaryHtml(report)
  const subject = `Dialer Calls — Daily Report (${label})`

  let sent = 0
  let failed = 0
  for (const to of recipients) {
    const { error } = await sendEmail({ to, subject, html, attachments })
    if (error) {
      failed++
      console.error(`[eod-dialer-report] Failed to send to ${to}:`, error)
    } else {
      sent++
    }
  }

  return NextResponse.json({
    ok: true,
    range: { from: fromISO, to: toISO },
    agents: report.summary.length,
    calls: report.detail.length,
    recipients: recipients.length,
    sent,
    failed,
    run_at: now.toISOString(),
  })
}
