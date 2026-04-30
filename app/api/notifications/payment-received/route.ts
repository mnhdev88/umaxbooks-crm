import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, buildPaymentReceivedEmail } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const { leadId, amount } = await req.json()

  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Notify admins and agents
  const { data: adminsAndAgents } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['admin', 'agent'])

  for (const user of adminsAndAgents || []) {
    await supabase.from('notifications').insert({
      user_id: user.id,
      lead_id: leadId,
      title: 'Payment Received — Go-Live Checklist',
      message: `Payment of $${amount?.toLocaleString() || '0'} received from ${lead.company_name}. Initiate go-live checklist.`,
      type: 'success',
    })

    if (user.email) {
      await sendEmail({
        to: user.email,
        ...buildPaymentReceivedEmail(lead.name, lead.company_name, amount || 0),
      })
    }
  }

  return NextResponse.json({ ok: true })
}
