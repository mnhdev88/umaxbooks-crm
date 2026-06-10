import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendLeadEmail } from '@/lib/email-send'

// Processes scheduled emails whose send time has passed. Trigger on a short
// interval (e.g. every 1–2 min) via the server crontab:
//   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/send-scheduled-emails
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (!publicOrigin) {
    return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 500 })
  }

  const nowISO = new Date().toISOString()

  // Find due scheduled emails (oldest first). Cap per run so a backlog can't
  // overrun a single invocation — the next tick drains the rest.
  const { data: due, error } = await service
    .from('email_sends')
    .select('id, lead_id, provider_id, sent_by, to_email, cc, bcc, subject, html_body, attachments')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!due?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No due scheduled emails' })
  }

  let sent = 0
  let failed = 0

  for (const row of due as any[]) {
    const result = await sendLeadEmail({
      service,
      lead_id: row.lead_id,
      provider_id: row.provider_id,
      sent_by: row.sent_by,
      to_email: row.to_email,
      cc: row.cc,
      bcc: row.bcc,
      subject: row.subject,
      html_body: row.html_body,
      attachments: row.attachments || [],
      publicOrigin,
      existingSendId: row.id,
    })
    if (result.ok) {
      sent++
    } else {
      failed++
      console.error(`[send-scheduled-emails] Failed to send ${row.id}:`, result.error)
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, sent, failed, run_at: nowISO })
}
