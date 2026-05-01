import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {

  const { to, clientName, businessName, message, links } = await req.json() as {
    to: string
    clientName: string
    businessName: string
    message?: string
    links: Array<{ title: string; url?: string }>
  }

  if (!to || !links?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'UMAX CRM'

  const linksHtml = links
    .filter(l => l.url)
    .map(
      l => `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9;">
          <a href="${l.url}" style="color: #f97316; font-weight: 600; font-size: 14px; text-decoration: none;">${l.title}</a>
          <br/>
          <span style="color: #94a3b8; font-size: 12px; word-break: break-all;">${l.url}</span>
        </td>
      </tr>`
    )
    .join('')

  const customMessageBlock = message
    ? `<p style="font-size:14px;color:#475569;line-height:1.7;background:#f8fafc;border-left:3px solid #f97316;padding:12px 16px;border-radius:0 6px 6px 0;margin:0 0 20px;">${message.replace(/\n/g, '<br/>')}</p>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#0a1628;padding:28px 32px;">
      <div style="color:#f97316;font-size:20px;font-weight:700;letter-spacing:-0.5px;">${agencyName}</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:4px;">Digital Marketing &amp; SEO Agency</div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 16px;">Hi ${clientName || 'there'},</p>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">
        We've put together some resources for <strong style="color:#0f172a;">${businessName}</strong> that we think you'll find useful.
      </p>

      ${customMessageBlock}

      <p style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Shared Resources</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;">
        ${linksHtml}
      </table>

      <p style="font-size:14px;color:#475569;line-height:1.7;margin:24px 0 0;">
        If you have any questions, just reply to this email — we're here to help.
      </p>
      <p style="font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:20px;margin-top:24px;">
        Sent by ${agencyName}. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body>
</html>`

  const { data, error } = await sendEmail({
    to,
    subject: `Resources for ${businessName} — ${agencyName}`,
    html,
  })

  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ success: true, id: data?.id })
}
