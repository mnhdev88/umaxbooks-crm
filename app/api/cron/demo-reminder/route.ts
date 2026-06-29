import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// How far ahead we look. With a 5-min cron cadence and a 15-min target, a window
// of 15 min means an appointment gets its reminder on the first tick where it's
// 15-or-fewer minutes away — i.e. roughly 10-15 min of lead time.
const LEAD_MINUTES = 15

/**
 * Notifies the people running an upcoming demo/call ~15 minutes before it starts,
 * so the agent is prepared in advance. Recipients (deduped): the lead's assigned
 * agent, whoever booked the appointment, and the sales manager(s) of either.
 *
 * Inserting a notifications row drives both the in-app bell and web push (the
 * dispatch_push_notification DB trigger fans out to /api/push/dispatch). The
 * reminder_sent_at column guards against double-notifying across cron ticks.
 *
 * Scheduled every 5 minutes — see vercel.json (and the EC2 server crontab, since
 * Vercel crons don't fire under PM2).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now    = new Date()
  const window = new Date(now.getTime() + LEAD_MINUTES * 60 * 1000)

  // Upcoming, not-yet-reminded appointments within the lead-time window.
  const { data: appts, error } = await supabase
    .from('appointments')
    .select('id, appointment_datetime, timezone, zoom_link, lead_id, created_by, lead:leads(name, company_name, assigned_agent_id)')
    .is('reminder_sent_at', null)
    .gt('appointment_datetime', now.toISOString())
    .lte('appointment_datetime', window.toISOString())
    .limit(200)

  if (error) {
    console.error('[demo-reminder] query failed:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!appts?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No upcoming appointments' })
  }

  // One round-trip to map every candidate agent → their sales manager.
  const agentIds = [
    ...new Set(
      (appts as any[]).flatMap((a) => [a.lead?.assigned_agent_id, a.created_by].filter(Boolean))
    ),
  ] as string[]

  const managerOf: Record<string, string | null> = {}
  if (agentIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, manager_id')
      .in('id', agentIds)
    for (const p of (profiles || []) as any[]) managerOf[p.id] = p.manager_id
  }

  let processed = 0
  let notified  = 0

  for (const appt of appts as any[]) {
    const lead = appt.lead
    const assigned = lead?.assigned_agent_id as string | null

    // Recipients: assigned agent, booker, and the manager(s) above either of them.
    const recipients = new Set<string>()
    if (assigned) recipients.add(assigned)
    if (appt.created_by) recipients.add(appt.created_by)
    if (assigned && managerOf[assigned]) recipients.add(managerOf[assigned]!)
    if (appt.created_by && managerOf[appt.created_by]) recipients.add(managerOf[appt.created_by]!)

    const apptTime = new Date(appt.appointment_datetime)
    const mins = Math.max(1, Math.round((apptTime.getTime() - now.getTime()) / 60000))
    const when = formatWhen(apptTime, appt.timezone)
    const who  = lead?.name
      ? `${lead.name}${lead.company_name ? ` (${lead.company_name})` : ''}`
      : 'a lead'

    const meetingLink = typeof appt.zoom_link === 'string' ? appt.zoom_link.trim() : ''
    const joinLine = meetingLink ? ` Join: ${meetingLink}` : ''

    if (recipients.size) {
      const rows = [...recipients].map((user_id) => ({
        user_id,
        lead_id: appt.lead_id,
        title:   `Demo in ${mins} min`,
        message: `Upcoming demo/call with ${who} at ${when}. Starts in about ${mins} min — time to prepare.${joinLine}`,
        type:    'warning',
        link:    appt.lead_id ? `/leads/${appt.lead_id}` : null,
      }))
      const { error: insErr } = await supabase.from('notifications').insert(rows)
      if (insErr) {
        // Don't stamp reminder_sent_at if we failed to notify — retry next tick.
        console.error(`[demo-reminder] notify failed for appt ${appt.id}:`, insErr)
        continue
      }
      notified += rows.length
    }

    // Stamp even when there were no recipients, so we don't re-scan it forever.
    await supabase
      .from('appointments')
      .update({ reminder_sent_at: now.toISOString() })
      .eq('id', appt.id)

    processed++
  }

  return NextResponse.json({
    ok: true,
    processed,
    notified,
    total_due: appts.length,
    run_at: now.toISOString(),
  })
}

/** Appointment time formatted in its own timezone (falls back gracefully). */
function formatWhen(date: Date, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }
}
