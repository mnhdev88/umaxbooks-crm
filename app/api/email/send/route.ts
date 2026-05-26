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

function injectTrackingPixel(html: string, pixelUrl: string): string {
  // Strip any tracking pixel from a previous send before injecting the fresh one
  const stripped = html.replace(/<img[^>]+\/api\/track\/open\/[^"'>]+[^>]*>/gi, '')
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;width:1px;height:1px;" alt="" />`
  if (stripped.includes('</body>')) return stripped.replace('</body>', `${pixel}</body>`)
  return stripped + pixel
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

  // Get provider + agent profile in parallel
  const [{ data: provider }, { data: agentProfile }] = await Promise.all([
    service.from('email_providers').select('*').eq('id', provider_id).single(),
    service.from('profiles').select('full_name, email').eq('id', user.id).single(),
  ])
  if (!provider) return NextResponse.json({ error: 'Email provider not found' }, { status: 400 })

  const providerEmail = provider.provider === 'gmail' ? provider.username : provider.from_email
  // Show agent's name to the receiver, but send through the configured SMTP address
  const agentDisplayName = agentProfile?.full_name || provider.from_name
  const from    = `${agentDisplayName} <${providerEmail}>`
  const replyTo = agentProfile?.email ? `${agentDisplayName} <${agentProfile.email}>` : undefined

  // If scheduling — save to email_sends and return (no tracking pixel for scheduled emails)
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

  // Create tracking record before sending so we can embed the pixel
  let trackingToken: string | null = null
  if (html_body) {
    const { data: tracking } = await service
      .from('email_tracking')
      .insert({ lead_id, user_id: user.id, to_email, subject })
      .select('token')
      .single()
    if (tracking) trackingToken = tracking.token
  }

  // Use the actual request origin (reflects Host header — correct on live and custom domains).
  // Fall back to NEXT_PUBLIC_APP_URL only if origin is somehow missing.
  const origin = req.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  const finalHtml = trackingToken && html_body
    ? injectTrackingPixel(html_body, `${origin}/api/track/open/${trackingToken}`)
    : html_body

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
        replyTo,
        to: [to_email],
        cc: cc ? [cc] : undefined,
        bcc: bcc ? [bcc] : undefined,
        subject,
        html: finalHtml,
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
        from, replyTo,
        to: to_email,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject, html: finalHtml,
        attachments: attachmentData,
      })
    }

    // Log to email_sends (store tracking_token so EmailHistory can show open status)
    await service.from('email_sends').insert({
      lead_id, sent_by: user.id, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body: finalHtml, attachments,
      status: 'sent', sent_at: new Date().toISOString(),
      tracking_token: trackingToken,
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
