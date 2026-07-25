import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { automatedEmailEnabled } from '@/lib/automated-email'

export async function POST(req: NextRequest) {
  const { developerId, companyName, leadName, notes } = await req.json()
  if (!developerId || !notes) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Automated email paused in Settings. The decline + notes are still on the demo,
  // so the developer sees them in the Dev Queue.
  if (!(await automatedEmailEnabled())) {
    return NextResponse.json({ success: true, skipped: 'automated-email-off' })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: developer } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', developerId)
    .single()

  if (!developer?.email) {
    return NextResponse.json({ skipped: true })
  }

  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Noveliotech CRM'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 560px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #0E0B24; padding: 28px 32px; }
    .header-brand { color: #f97316; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .header-sub { color: #94a3b8; font-size: 12px; margin-top: 4px; }
    .body { padding: 32px; }
    .greeting { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
    .text { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 16px; }
    .notes-box { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #ef4444; border-radius: 8px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #7f1d1d; white-space: pre-wrap; line-height: 1.6; }
    .cta { display: block; background: #f97316; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; margin: 24px 0; }
    .note { font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 8px; }
    .biz { font-weight: 600; color: #f97316; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-brand">${agencyName}</div>
      <div class="header-sub">CRM — Demo Revision Required</div>
    </div>
    <div class="body">
      <div class="greeting">Demo Declined — Revision Required</div>
      <p class="text">Hi <span class="biz">${developer.full_name || 'Developer'}</span>,</p>
      <p class="text">
        The demo for <span class="biz">${companyName}</span> has been reviewed and declined by admin.
        Please read the revision notes below and resubmit an updated demo.
      </p>
      <div class="notes-box">${notes}</div>
      <p class="text">Log in to the Dev Queue to view the lead details and resubmit your demo.</p>
      <a href="${appUrl}/developer-queue" class="cta">Open Dev Queue →</a>
      <p class="note">
        This notification was sent by ${agencyName} CRM. Log in to take action.
      </p>
    </div>
  </div>
</body>
</html>`

  await sendEmail({
    to: developer.email,
    subject: `Demo Declined — Revision Required: ${companyName}`,
    html,
  })

  return NextResponse.json({ success: true })
}
