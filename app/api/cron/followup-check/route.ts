import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

const TERMINAL_STATUSES = ['Live', 'Completed', 'Lost']
const FOLLOWUP_INTERVAL_DAYS = 5

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now     = new Date()
  const cutoff  = new Date(now.getTime() - FOLLOWUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
  const cutoffISO = cutoff.toISOString()

  // Find leads eligible for auto follow-up:
  // - created 5+ days ago
  // - not in a terminal status
  // - never had a follow-up sent, OR last one was 5+ days ago
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, company_name, email, status, assigned_agent_id, created_at, last_followup_sent_at')
    .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
    .lte('created_at', cutoffISO)
    .or(`last_followup_sent_at.is.null,last_followup_sent_at.lte.${cutoffISO}`)

  if (!leads?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No eligible leads' })
  }

  // Get first available email template
  const { data: template } = await supabase
    .from('email_templates')
    .select('id, subject, html_body')
    .limit(1)
    .maybeSingle()

  if (!template) {
    return NextResponse.json({ ok: false, error: 'No email template found. Add one in Settings.' }, { status: 422 })
  }

  let processed = 0
  let skipped   = 0

  for (const lead of leads as any[]) {
    if (!lead.email) {
      skipped++
      continue
    }

    // Replace common template placeholders
    const subject = (template.subject as string)
      .replace(/\{\{company_name\}\}/gi, lead.company_name)
      .replace(/\{\{name\}\}/gi, lead.name)
      .replace(/\{\{first_name\}\}/gi, lead.name.split(' ')[0])

    const html = (template.html_body as string)
      .replace(/\{\{company_name\}\}/gi, lead.company_name)
      .replace(/\{\{name\}\}/gi, lead.name)
      .replace(/\{\{first_name\}\}/gi, lead.name.split(' ')[0])

    const { error: sendError } = await sendEmail({ to: lead.email, subject, html })

    if (sendError) {
      console.error(`[followup-check] Failed to email lead ${lead.id}:`, sendError)
      skipped++
      continue
    }

    const sentAt = now.toISOString()

    // Record in email_sends for history (best-effort)
    try {
      await supabase.from('email_sends').insert({
        lead_id:   lead.id,
        sent_by:   null,
        to_email:  lead.email,
        subject,
        html_body: html,
        status:    'sent',
        sent_at:   sentAt,
      })
    } catch {}

    // Update lead's last_followup_sent_at
    await supabase
      .from('leads')
      .update({ last_followup_sent_at: sentAt })
      .eq('id', lead.id)

    // Notify assigned agent
    if (lead.assigned_agent_id) {
      await supabase.from('notifications').insert({
        user_id: lead.assigned_agent_id,
        lead_id: lead.id,
        title:   'Auto Follow-up Sent',
        message: `A follow-up email was sent automatically to ${lead.company_name}. Time to reach out personally.`,
        type:    'info',
      })
    }

    // Activity log
    try {
      await supabase.from('activity_logs').insert({
        lead_id: lead.id,
        user_id: null,
        action:  'Auto Follow-up Email Sent',
        details: `Automated follow-up email sent to ${lead.email} (${FOLLOWUP_INTERVAL_DAYS}+ days since creation).`,
      })
    } catch {}

    processed++
  }

  return NextResponse.json({
    ok: true,
    processed,
    skipped,
    total_eligible: leads.length,
    run_at: now.toISOString(),
  })
}
