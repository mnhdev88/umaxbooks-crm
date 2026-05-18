import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const { lead_id, ticket_title, company_name } = await req.json()
  if (!lead_id || !ticket_title) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: staff } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'sales_agent'])

  if (staff && staff.length > 0) {
    await supabase.from('notifications').insert(
      staff.map((s: any) => ({
        user_id: s.id,
        lead_id,
        title: 'New Support Ticket',
        message: `${company_name || 'A client'} raised a ticket: "${ticket_title}"`,
        type: 'info',
      }))
    )
  }

  return NextResponse.json({ ok: true })
}
