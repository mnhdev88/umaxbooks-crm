import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const { to, clientName, businessName, shortUrl } = await req.json()
  if (!to || !shortUrl) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'UMAX CRM'

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 560px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #0a1628; padding: 28px 32px; }
    .header-brand { color: #f97316; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .header-sub { color: #94a3b8; font-size: 12px; margin-top: 4px; }
    .body { padding: 32px; }
    .greeting { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
    .text { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 16px; }
    .cta { display: block; background: #f97316; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; margin: 24px 0; }
    .note { font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 8px; }
    .biz { font-weight: 600; color: #f97316; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-brand">${agencyName}</div>
      <div class="header-sub">Digital Marketing &amp; SEO Agency</div>
    </div>
    <div class="body">
      <div class="greeting">Hi ${clientName},</div>
      <p class="text">
        We've completed the SEO audit for <span class="biz">${businessName}</span> and your summary report is ready to view.
      </p>
      <p class="text">
        This report highlights the key findings, your current SEO score, and the top priority improvements we recommend to grow your online visibility.
      </p>
      <a href="${shortUrl}" class="cta">View Your SEO Report →</a>
      <p class="text">
        If you have any questions about the findings or would like to schedule a call to walk through the results, just reply to this email — we're happy to help.
      </p>
      <p class="note">
        This report was prepared by ${agencyName}. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body>
</html>`

  const { data, error } = await sendEmail({
    to,
    subject: `Your SEO Audit Report — ${businessName}`,
    html,
  })

  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ success: true, id: data?.id })
}
