import nodemailer from 'nodemailer'
import { Resend } from 'resend'

// ---- HTML helpers (tracking pixel, click rewriting, unsubscribe footer) ----

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

// ---------------------------------------------------------------------------

export interface SendLeadEmailParams {
  service: any                          // Supabase service-role client
  lead_id: string
  provider_id: string
  sent_by: string | null               // agent profile id (for from name + tracking)
  to_email: string
  cc?: string | null
  bcc?: string | null
  subject: string
  html_body: string
  attachments?: { name: string; url: string }[]
  publicOrigin: string                  // base URL for tracking/unsubscribe links
  existingSendId?: string               // if set, UPDATE this row instead of INSERTing a new one
}

export type SendLeadEmailResult =
  | { ok: true }
  | { ok: false; error: string; status: number }

/**
 * Delivers a single lead email through its configured provider, injects open/click
 * tracking, records the result in `email_sends`, and runs the usual side effects
 * (promote lead, activity log, clear draft).
 *
 * Shared by the interactive send route and the scheduled-email cron so both paths
 * behave identically. When `existingSendId` is provided (the scheduled row), the
 * existing record is updated in place rather than inserting a duplicate.
 */
export async function sendLeadEmail(params: SendLeadEmailParams): Promise<SendLeadEmailResult> {
  const {
    service, lead_id, provider_id, sent_by,
    to_email, cc, bcc, subject, html_body,
    attachments = [], publicOrigin, existingSendId,
  } = params

  const ccEmails  = cc  ? cc.split(',').map((e: string) => e.trim()).filter(Boolean)  : []
  const bccEmails = bcc ? bcc.split(',').map((e: string) => e.trim()).filter(Boolean) : []

  // Block send if lead has unsubscribed
  const { data: leadCheck } = await service
    .from('leads')
    .select('email_unsubscribed')
    .eq('id', lead_id)
    .single()
  if (leadCheck?.email_unsubscribed) {
    if (existingSendId) {
      await service.from('email_sends')
        .update({ status: 'failed', error: 'Lead has unsubscribed from emails.' })
        .eq('id', existingSendId)
    }
    return { ok: false, error: 'This lead has unsubscribed from emails.', status: 403 }
  }

  // Resolve provider + sending agent profile
  const [{ data: provider }, { data: agentProfile }] = await Promise.all([
    service.from('email_providers').select('*').eq('id', provider_id).single(),
    sent_by
      ? service.from('profiles').select('full_name, email').eq('id', sent_by).single()
      : Promise.resolve({ data: null }),
  ])
  if (!provider) return { ok: false, error: 'Email provider not found', status: 400 }

  const providerEmail = provider.provider === 'gmail' ? provider.username : provider.from_email
  const agentDisplayName = agentProfile?.full_name || provider.from_name
  // Gmail enforces the authenticated account as from — all other providers (SendGrid, SES,
  // custom) allow the agent's own email so the lead sees who actually sent it.
  const fromEmail = provider.provider === 'gmail'
    ? providerEmail
    : (agentProfile?.email || providerEmail)
  const from = `${agentDisplayName} <${fromEmail}>`

  // Create tracking record before sending so we can embed the pixel
  let trackingToken: string | null = null
  if (html_body) {
    const { data: tracking } = await service
      .from('email_tracking')
      .insert({ lead_id, user_id: sent_by, to_email, subject })
      .select('token')
      .single()
    if (tracking) trackingToken = tracking.token
  }

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
      attachments.map((a) => fetchAttachment(a.url, a.name))
    )
  } catch (err: any) {
    return { ok: false, error: err.message, status: 400 }
  }

  let sgMessageId: string | null = null

  try {
    if (provider.provider === 'resend') {
      const resend = new Resend(provider.api_key)
      const { error } = await resend.emails.send({
        from,
        to: [to_email],
        cc: ccEmails.length ? ccEmails : undefined,
        bcc: bccEmails.length ? bccEmails : undefined,
        subject,
        html: finalHtml,
        attachments: attachmentData.map(a => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        })),
      })
      if (error) throw new Error(error.message)
    } else if (provider.provider === 'sendgrid') {
      // SendGrid Web API via fetch — gives delivery/bounce webhooks unlike SMTP
      const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.password}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: agentDisplayName },
          personalizations: [{
            to: [{ email: to_email }],
            ...(ccEmails.length  ? { cc:  ccEmails.map((e: string)  => ({ email: e })) } : {}),
            ...(bccEmails.length ? { bcc: bccEmails.map((e: string) => ({ email: e })) } : {}),
          }],
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
        from,
        to: to_email,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject, html: finalHtml,
        attachments: attachmentData,
      })
    }

    // Record success — update the scheduled row if there is one, else insert fresh
    const sentRow = {
      lead_id, sent_by, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body: finalHtml, attachments,
      status: 'sent', sent_at: new Date().toISOString(),
      scheduled_at: null,
      error: null,
      tracking_token: trackingToken,
      sendgrid_message_id: sgMessageId,
    }
    if (existingSendId) {
      await service.from('email_sends').update(sentRow).eq('id', existingSendId)
    } else {
      await service.from('email_sends').insert(sentRow)
    }

    // Promote New leads to Contacted on first email
    await service.from('leads').update({ status: 'Contacted' }).eq('id', lead_id).eq('status', 'New')

    // Activity log
    const attNames = (attachments as any[]).map((a) => a.name).join(', ')
    await service.from('activity_logs').insert({
      lead_id, user_id: sent_by,
      action: 'Email Sent to Client',
      details: `To: ${to_email} · Subject: ${subject}${attNames ? ` · Attachments: ${attNames}` : ''}${cc ? ` · CC: ${cc}` : ''}`,
    })

    // Delete draft if exists
    await service.from('email_drafts').delete().eq('lead_id', lead_id)

    return { ok: true }
  } catch (err: any) {
    const failedRow = {
      lead_id, sent_by, provider_id,
      from_email: from, to_email, cc: cc || null, bcc: bcc || null,
      subject, html_body, attachments,
      status: 'failed', error: err.message,
    }
    if (existingSendId) {
      await service.from('email_sends').update(failedRow).eq('id', existingSendId)
    } else {
      await service.from('email_sends').insert(failedRow)
    }
    return { ok: false, error: err.message, status: 400 }
  }
}
