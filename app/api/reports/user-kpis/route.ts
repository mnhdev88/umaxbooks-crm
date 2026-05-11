import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function periodStart(period: string): string | null {
  const now = new Date()
  if (period === '7d')    { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString() }
  if (period === '30d')   { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString() }
  if (period === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  return null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!myProfile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const period = req.nextUrl.searchParams.get('period') || 'month'
  const start  = periodStart(period)
  const isAdmin = myProfile.role === 'admin'

  // Which users to show
  const { data: allUsers } = isAdmin
    ? await supabase.from('profiles').select('id, full_name, role').in('role', ['admin', 'agent', 'sales_agent']).order('full_name')
    : await supabase.from('profiles').select('id, full_name, role').eq('id', user.id)

  if (!allUsers?.length) return NextResponse.json({ kpis: [] })

  const userIds = allUsers.map(u => u.id)

  // Leads Added — via activity_logs (always exists, no migration needed)
  let addedQ = supabase.from('activity_logs').select('user_id').in('user_id', userIds).eq('action', 'Lead Created')
  if (start) addedQ = addedQ.gte('created_at', start)
  const { data: leadsAdded } = await addedQ

  // Leads Assigned
  let assignedQ = supabase.from('leads').select('assigned_agent_id').in('assigned_agent_id', userIds)
  if (start) assignedQ = assignedQ.gte('created_at', start)
  const { data: leadsAssigned } = await assignedQ

  // Leads Completed (status = Completed, assigned to user)
  let completedQ = supabase.from('leads').select('assigned_agent_id').in('assigned_agent_id', userIds).eq('status', 'Completed')
  if (start) completedQ = completedQ.gte('updated_at', start)
  const { data: completedLeads } = await completedQ

  // Demos Booked (appointments with a demo datetime, created by user)
  let demosQ = supabase.from('appointments').select('created_by').in('created_by', userIds).not('appointment_datetime', 'is', null)
  if (start) demosQ = demosQ.gte('created_at', start)
  const { data: demosBooked } = await demosQ

  // Deals Closed (Paid) + Revenue — linked via leads.assigned_agent_id
  let dealsQ = supabase
    .from('deals')
    .select('final_payment_amount, leads(assigned_agent_id)')
    .eq('payment_status', 'Paid')
  if (start) dealsQ = dealsQ.gte('created_at', start)
  const { data: deals } = await dealsQ

  // Build per-user aggregates
  const kpis = allUsers.map(u => {
    const leadsAddedCount    = leadsAdded?.filter(l => l.user_id === u.id).length || 0
    const leadsAssignedCount = leadsAssigned?.filter(l => l.assigned_agent_id === u.id).length || 0
    const completedCount     = completedLeads?.filter(l => l.assigned_agent_id === u.id).length || 0
    const demosBookedCount   = demosBooked?.filter(a => a.created_by === u.id).length || 0
    const userDeals          = (deals as any[])?.filter(d => d.leads?.assigned_agent_id === u.id) || []
    const dealsClosedCount   = userDeals.length
    const revenue            = userDeals.reduce((sum: number, d: any) => sum + (d.final_payment_amount || 0), 0)

    return {
      id: u.id,
      full_name: u.full_name,
      role: u.role,
      leads_added:    leadsAddedCount,
      leads_assigned: leadsAssignedCount,
      leads_completed: completedCount,
      demos_booked:   demosBookedCount,
      deals_closed:   dealsClosedCount,
      revenue,
    }
  })

  return NextResponse.json({ kpis })
}
