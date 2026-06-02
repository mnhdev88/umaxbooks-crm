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

function rewriteLinksForTracking(html: string, clickBaseUrl: string): string {
  // Rewrite every <a href="..."> to go through the click tracker then redirect.
  // Skip: mailto:, tel:, already-tracked links, and the unsubscribe link.
  return html.replace(/(<a\s[^>]*href=")([^"]+)(")/gi, (_match, open, href, close) => {
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.includes('/api/track/') ||
      href.includes('/api/unsubscribe/')
    ) {
      return `${open}${href}${close}`
    }
    return `${open}${clickBaseUrl}?url=${encodeURIComponent(href)}${close}`
  })
}

function injectUnsubscribeFooter(html: string, unsubscribeUrl: string): string {
  const footer = `
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #334155;text-align:center;font-family:sans-serif;font-size:11px;color:#64748b;">
  Don't want to receive these emails?
  <a href="${unsubscribeUrl}" style="color:#94a3b8;text-decoration:underline;margin-left:4px;">Unsubscribe</a>
</div>`
  if (html.includes('</body>')) return html.replace('</body>', `${footer}</body>`)
  return html + footer
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

  // Block send if lead has unsubscribed
  const { data: leadCheck } = await service
    .from('leads')
    .select('email_unsubscribed')
    .eq('id', lead_id)
    .single()
  if (leadCheck?.email_unsubscribed) {
    return NextResponse.json({ error: 'This lead has unsubscribed from emails.' }, { status: 403 })
  }

  // Get provider + agent profile in parallel
  const [{ data: provider }, { data: agentProfile }] = await Promise.all([
    service.from('email_providers').select('*').eq('id', provider_id).single(),
    service.from('profiles').select('full_name, email').eq('id', user.id).single(),
  ])
  if (!provider) return NextResponse.json({ error: 'Email provider not found' }, { status: 400 })

  const providerEmail = provider.provider === 'gmail' ? provider.username : provider.from_email
  const agentDisplayName = agentProfile?.full_name || provider.from_name
  // Gmail enforces the authenticated account as from — all other providers (SendGrid, SES, custom)
  // allow using the agent's own email so the lead sees who actually sent it.
  const fromEmail = provider.provider === 'gmail'
    ? providerEmail
    : (agentProfile?.email || providerEmail)
  const from    = `${agentDisplayName} <${fromEmail}>`
  const replyTo = undefined // from IS the agent's email, no need for a separate reply-to

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

  // Build the public-facing base URL from request headers.
  // req.nextUrl.origin resolves to 0.0.0.0 behind a reverse proxy, so we read
  // x-forwarded-host / x-forwarded-proto which the proxy always sets correctly.
  const fwdHost     = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const fwdProto    = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https'
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    || (fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin)
  let finalHtml = html_body
  if (trackingToken && finalHtml) {
    finalHtml = injectTrackingPixel(finalHtml, `${publicOrigin}/api/track/open/${trackingToken}`)
    finalHtml = rewriteLinksForTracking(finalHtml, `${publicOrigin}/api/track/click/${trackingToken}`)
    finalHtml = injectUnsubscribeFooter(finalHtml, `${publicOrigin}/api/unsubscribe/${trackingToken}`)
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

  let sgMessageId: string | null = null

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
    } else if (provider.provider === 'sendgrid') {
      // SendGrid Web API via fetch — no SDK needed, gives delivery/bounce webhooks unlike SMTP
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.password}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: agentDisplayName },
          personalizations: [{ to: [{ email: to_email }], ...(cc ? { cc: [{ email: cc }] } : {}), ...(bcc ? { bcc: [{ email: bcc }] } : {}) }],
          subject,
          content: [{ type: 'text/html', value: finalHtml || '' }],
          attachments: attachmentData.length ? attachmentData.map(a => ({
            filename: a.filename,
            content: a.content.toString('base64'),
            type: a.contentType,
            disposition: 'attachment',
          })) : undefined,
        }),
      })
      if (!sgRes.ok) {
        const err = await sgRes.json().catch(() => ({}))
        throw new Error((err as any)?.errors?.[0]?.message || `SendGrid error ${sgRes.status}`)
      }
      // Store message ID so webhook events can be matched back to this send
      sgMessageId = sgRes.headers.get('x-message-id') || null
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
      sendgrid_message_id: sgMessageId,
    })

    // Promote New leads to Contacted on first email
    await service.from('leads').update({ status: 'Contacted' }).eq('id', lead_id).eq('status', 'New')

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
