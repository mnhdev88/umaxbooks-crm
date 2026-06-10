import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendLeadEmail } from '@/lib/email-send'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lead_id, provider_id, to_email, cc, bcc, subject, html_body, attachments = [], scheduled_at } = body

  if (!lead_id || !to_email || !subject) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const service = createServiceClient()

  // If scheduling — save to email_sends and return. The send-scheduled-emails cron
  // picks it up once scheduled_at passes and runs it through the same send path below.
  if (scheduled_at) {
    // Resolve from_email for display only (the cron re-derives it at send time)
    const { data: provider } = await service
      .from('email_providers').select('provider, from_email, from_name, username').eq('id', provider_id).single()
    const { data: agentProfile } = await service
      .from('profiles').select('full_name, email').eq('id', user.id).single()
    const providerEmail = provider?.provider === 'gmail' ? provider?.username : provider?.from_email
    const fromEmail = provider?.provider === 'gmail' ? providerEmail : (agentProfile?.email || providerEmail)
    const from = `${agentProfile?.full_name || provider?.from_name || ''} <${fromEmail}>`

    const { error } = await service.from('email_sends').insert({
      lead_id, sent_by: user.id, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body, attachments,
      status: 'scheduled', scheduled_at,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, scheduled: true })
  }

  // Build the public-facing base URL from request headers.
  // req.nextUrl.origin resolves to 0.0.0.0 behind a reverse proxy, so we read
  // x-forwarded-host / x-forwarded-proto which the proxy always sets correctly.
  const fwdHost  = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const fwdProto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https'
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    || (fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin)

  const result = await sendLeadEmail({
    service, lead_id, provider_id, sent_by: user.id,
    to_email, cc, bcc, subject, html_body, attachments, publicOrigin,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
