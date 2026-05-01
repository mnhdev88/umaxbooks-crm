import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lead_id = req.nextUrl.searchParams.get('lead_id')
  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  const { data } = await supabase
    .from('email_sends')
    .select('*, sender:sent_by(full_name)')
    .eq('lead_id', lead_id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ sends: data || [] })
}

// Send a scheduled email now
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const service = createServiceClient()

  const { data: send } = await service.from('email_sends').select('*').eq('id', id).single()
  if (!send) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Re-trigger send via the send route
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
    body: JSON.stringify({
      lead_id: send.lead_id, provider_id: send.provider_id,
      to_email: send.to_email, cc: send.cc, bcc: send.bcc,
      subject: send.subject, html_body: send.html_body,
      attachments: send.attachments,
    }),
  })

  if (res.ok) {
    await service.from('email_sends').delete().eq('id', id)
  }

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
