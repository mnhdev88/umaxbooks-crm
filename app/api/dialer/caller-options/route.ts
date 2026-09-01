import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getReportDayConfig } from '@/lib/report-config'
import { reportingDate, reportingDayWindow } from '@/lib/reporting-day'

/**
 * GET /api/dialer/caller-options — the caller-ID choices for the pre-call modal's
 * "Call from" dropdown.
 *
 * Deliberately NOT under /api/voice: that whole prefix is whitelisted from the auth
 * redirect in proxy.ts (Twilio webhooks have no session), so a route placed there
 * would hand the number pool to anyone who asked. This one requires a session —
 * every dialer user (admin, manager, sales agent) may read it, since they can all
 * place calls.
 *
 * Read-only and non-admin, which is why it doesn't reuse /api/settings/caller-numbers
 * (admin-gated, and returns notes + 30-day health an agent has no use for).
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The pool lives behind RLS aimed at admins; this route has already established a
  // session, so the service client just gets past that for a read we've authorised.
  const service = createServiceClient()

  const { data: numbers, error } = await service
    .from('caller_numbers')
    .select('id, phone_number, label, daily_cap, inbound_mode, auto_rotate')
    // is_active, not auto_rotate: a manual-only number (108) belongs in this list —
    // being excluded from the automatic rotation is exactly why an agent has to pick
    // it by hand. The modal labels it so the choice is informed.
    .eq('is_active', true)
    .order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Usage on the same reporting-day boundary the picker caps against, so "12/50 today"
  // in the dropdown matches what the selector will actually do. Mirrors the query in
  // lib/voice/caller-numbers.ts.
  const cfg = await getReportDayConfig(service)
  const { fromISO, toISO } = reportingDayWindow(reportingDate(new Date(), cfg), cfg)

  const { data: todayRows } = await service
    .from('voice_calls')
    .select('from_number')
    .eq('provider', 'twilio')
    .eq('direction', 'outbound')
    .gte('created_at', fromISO)
    .lt('created_at', toISO)
    .not('from_number', 'is', null)

  const usedToday: Record<string, number> = {}
  for (const r of (todayRows || []) as { from_number: string }[]) {
    usedToday[r.from_number] = (usedToday[r.from_number] || 0) + 1
  }

  return NextResponse.json({ numbers: numbers || [], usedToday })
}
