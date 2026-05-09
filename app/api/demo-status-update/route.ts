import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: lead } = await supabase
    .from('leads')
    .select('status, company_name, assigned_agent_id')
    .eq('id', leadId)
    .single()

  if (lead?.status !== 'Contacted') {
    return NextResponse.json({ skipped: true })
  }

  await supabase
    .from('leads')
    .update({ status: 'Audit Ready' })
    .eq('id', leadId)

  // Determine who to notify
  let recipientIds: string[] = []

  if (lead.assigned_agent_id) {
    recipientIds = [lead.assigned_agent_id]
  } else {
    // No assigned agent — notify all sales agents and admins
    const { data: staff } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['sales_agent', 'admin'])
    recipientIds = (staff || []).map((s: any) => s.id)
  }

  if (recipientIds.length > 0) {
    await supabase.from('notifications').insert(
      recipientIds.map((uid) => ({
        user_id: uid,
        lead_id: leadId,
        title: 'Demo Ready — Schedule Client Call',
        message: `The demo for "${lead.company_name}" has been uploaded. Schedule the client demo call now.`,
        type: 'info',
      }))
    )
  }

  return NextResponse.json({ success: true })
}
