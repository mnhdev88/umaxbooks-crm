import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

async function fetchAttachment(url: string, name: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${name}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  return { filename: name, content: buffer, contentType }
}

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

  // Get provider
  const { data: provider } = await service.from('email_providers').select('*').eq('id', provider_id).single()
  if (!provider) return NextResponse.json({ error: 'Email provider not found' }, { status: 400 })

  const from = `${provider.from_name} <${provider.provider === 'gmail' ? provider.username : provider.from_email}>`

  // If scheduling — save to email_sends and return
  if (scheduled_at) {
    const { error } = await service.from('email_sends').insert({
      lead_id, sent_by: user.id, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body, attachments,
      status: 'scheduled', scheduled_at,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, scheduled: true })
  }

  // Fetch attachment buffers
  let attachmentData: any[] = []
  try {
    attachmentData = await Promise.all(
      attachments.map((a: { name: string; url: string }) => fetchAttachment(a.url, a.name))
    )
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }

  try {
    if (provider.provider === 'resend') {
      const resend = new Resend(provider.api_key)
      const { error } = await resend.emails.send({
        from,
        to: [to_email],
        cc: cc ? [cc] : undefined,
        bcc: bcc ? [bcc] : undefined,
        subject,
        html: html_body,
        attachments: attachmentData.map(a => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        })),
      })
      if (error) throw new Error(error.message)
    } else {
      const transporter = nodemailer.createTransport({
        host: provider.host,
        port: provider.port,
        secure: provider.secure,
        auth: { user: provider.username, pass: provider.password },
      })
      await transporter.sendMail({
        from, to: to_email,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject, html: html_body,
        attachments: attachmentData,
      })
    }

    // Log to email_sends
    await service.from('email_sends').insert({
      lead_id, sent_by: user.id, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body, attachments,
      status: 'sent', sent_at: new Date().toISOString(),
    })

    // Activity log
    const attNames = attachments.map((a: any) => a.name).join(', ')
    await service.from('activity_logs').insert({
      lead_id, user_id: user.id,
      action: 'Email Sent to Client',
      details: `To: ${to_email} · Subject: ${subject}${attNames ? ` · Attachments: ${attNames}` : ''}${cc ? ` · CC: ${cc}` : ''}`,
    })

    // Delete draft if exists
    await service.from('email_drafts').delete().eq('lead_id', lead_id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    await service.from('email_sends').insert({
      lead_id, sent_by: user.id, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body, attachments,
      status: 'failed', error: err.message,
    })
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
