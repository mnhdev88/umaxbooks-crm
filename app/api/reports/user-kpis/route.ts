import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRange } from '@/lib/report-range'

function periodStart(period: string): string | null {
  const now = new Date()
  if (period === 'today') { return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
  if (period === '7d')    { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString() }
  if (period === '30d')   { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString() }
  if (period === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  return null
}

// Apply the resolved [start, end) calendar bounds to a query on `column`.
function withRange<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
  q: T, column: string, start: string | null, end: string | null,
): T {
  if (start) q = q.gte(column, start)
  if (end) q = q.lt(column, end)
  return q
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!myProfile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Prefer an explicit calendar range (from/to); fall back to legacy `period`.
  const from = req.nextUrl.searchParams.get('from') || undefined
  const to   = req.nextUrl.searchParams.get('to') || undefined
  const period = req.nextUrl.searchParams.get('period') || 'month'
  const hasRange = Boolean(from || to)
  const range = resolveRange(from, to)
  const start = hasRange ? range.fromISO : periodStart(period)
  const end   = hasRange ? range.toISO : null
  const isAdmin = myProfile.role === 'admin'

  // Which users to show
  const { data: allUsers } = isAdmin
    ? await supabase.from('profiles').select('id, full_name, role').in('role', ['agent', 'sales_agent']).order('full_name')
    : await supabase.from('profiles').select('id, full_name, role').eq('id', user.id)

  if (!allUsers?.length) return NextResponse.json({ kpis: [] })

  const userIds = allUsers.map(u => u.id)

  // Leads Added — via activity_logs
  let addedQ = supabase.from('activity_logs').select('user_id').in('user_id', userIds).eq('action', 'Lead Created')
  addedQ = withRange(addedQ, 'created_at', start, end)
  const { data: leadsAdded } = await addedQ

  // Leads Assigned — total leads currently assigned to each user (no date filter;
  // assignment date is not tracked separately so we show the current snapshot)
  const { data: leadsAssigned } = await supabase
    .from('leads')
    .select('assigned_agent_id')
    .in('assigned_agent_id', userIds)

  // Leads Completed (status = Completed, assigned to user, completed in period)
  let completedQ = supabase.from('leads').select('assigned_agent_id').in('assigned_agent_id', userIds).eq('status', 'Completed')
  completedQ = withRange(completedQ, 'updated_at', start, end)
  const { data: completedLeads } = await completedQ

  // Demos Booked (appointments with a demo datetime, created by user, in period)
  let demosQ = supabase.from('appointments').select('created_by').in('created_by', userIds).not('appointment_datetime', 'is', null)
  demosQ = withRange(demosQ, 'created_at', start, end)
  const { data: demosBooked } = await demosQ

  // Deals Closed (Paid) + Revenue — filter by when payment was recorded (updated_at)
  let dealsQ = supabase
    .from('deals')
    .select('final_payment_amount, lead_id, leads!inner(assigned_agent_id)')
    .eq('payment_status', 'Paid')
  dealsQ = withRange(dealsQ, 'updated_at', start, end)
  const { data: deals } = await dealsQ

  // Build per-user aggregates
  const kpis = allUsers.map(u => {
    const leadsAddedCount    = leadsAdded?.filter(l => l.user_id === u.id).length || 0
    const leadsAssignedCount = leadsAssigned?.filter(l => l.assigned_agent_id === u.id).length || 0
    const completedCount     = completedLeads?.filter(l => l.assigned_agent_id === u.id).length || 0
    const demosBookedCount   = demosBooked?.filter(a => a.created_by === u.id).length || 0
    const userDeals          = (deals as any[])?.filter(d => (d.leads as any)?.assigned_agent_id === u.id) || []
    const dealsClosedCount   = userDeals.length
    const revenue            = userDeals.reduce((sum: number, d: any) => sum + (d.final_payment_amount || 0), 0)

    return {
      id: u.id,
      full_name: u.full_name,
      role: u.role,
      leads_added:     leadsAddedCount,
      leads_assigned:  leadsAssignedCount,
      leads_completed: completedCount,
      demos_booked:    demosBookedCount,
      deals_closed:    dealsClosedCount,
      revenue,
    }
  })

  return NextResponse.json({ kpis })
}
