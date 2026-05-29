import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email'

function getPublicOrigin(req: NextRequest): string {
  const fwdHost  = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const fwdProto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https'
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    || (fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const origin = getPublicOrigin(req)

  const supabase = createServiceClient()

  const { data: send } = await supabase
    .from('email_sends')
    .select('lead_id, to_email')
    .eq('tracking_token', token)
    .maybeSingle()

  if (!send?.lead_id) {
    return NextResponse.redirect(`${origin}/unsubscribed?error=1`)
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('company_name, email_unsubscribed')
    .eq('id', send.lead_id)
    .single()

  if (!lead?.email_unsubscribed) {
    await supabase
      .from('leads')
      .update({ email_unsubscribed: true, email_unsubscribed_at: new Date().toISOString() })
      .eq('id', send.lead_id)

    await sendEmail({
      to: 'info@noveliotech.com',
      subject: `Unsubscribe Request — ${lead?.company_name || send.to_email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#f97316;">Unsubscribe Notification</h2>
          <p><strong>${lead?.company_name || send.to_email}</strong> has unsubscribed from marketing emails.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px 0;color:#64748b;width:120px;">Email</td><td>${send.to_email}</td></tr>
            ${lead?.company_name ? `<tr><td style="padding:6px 0;color:#64748b;">Business</td><td>${lead.company_name}</td></tr>` : ''}
          </table>
          <p style="margin-top:16px;color:#64748b;font-size:13px;">This lead will no longer receive emails from the CRM system.</p>
        </div>
      `,
    })
  }

  return NextResponse.redirect(`${origin}/unsubscribed`)
}
