import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['admin', 'agent', 'sales_agent'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — only admins and agents can send invites' }, { status: 403 })
  }

  const body = await req.json()
  const { email, full_name, lead_id } = body

  if (!email || !lead_id) {
    return NextResponse.json({ error: 'email and lead_id are required' }, { status: 400 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' }, { status: 500 })
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/set-password`
  const clientName = (full_name ?? email.split('@')[0]) as string

  // generateLink creates the user and returns the invite URL without sending
  // Supabase's default email (which shows localhost and "powered by Supabase").
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      data: { role: 'client', lead_id, full_name: clientName },
      redirectTo,
    },
  })

  if (linkError) {
    const msg = linkError.message ?? ''
    if (msg.toLowerCase().includes('already')) {
      return NextResponse.json({
        error: `This email (${email}) already has an account. They can log in at the portal directly.`,
      }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Upsert the profile now so the client's portal works immediately on first login.
  // We can't rely solely on the DB trigger because it may not populate lead_id / role
  // from user_metadata in all Supabase versions.
  const userId = (linkData as any)?.user?.id
  if (userId) {
    await adminSupabase.from('profiles').upsert(
      { id: userId, full_name: clientName, role: 'client', lead_id },
      { onConflict: 'id' }
    )
  }

  // Take Supabase's action_link (correct token format) and override redirect_to.
  // We cannot construct the URL from hashed_token — the verify endpoint expects the raw
  // email_otp token, not the hash; using hashed_token produces an otp_expired error.
  const actionLink: string | undefined = (linkData as any)?.properties?.action_link
  if (!actionLink) {
    return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 })
  }
  let inviteUrl = actionLink
  try {
    const parsed = new URL(actionLink)
    parsed.searchParams.set('redirect_to', redirectTo)
    inviteUrl = parsed.toString()
  } catch { /* use actionLink as-is if URL parse fails */ }

  // Send branded invite email via our configured email provider
  const service = createServiceClient()
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (!provider) {
    return NextResponse.json({ error: 'No email provider configured. Set one up in Settings → Email.' }, { status: 500 })
  }

  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(90deg,#1F3A93,#4a6cf7);height:5px;border-radius:4px 4px 0 0"></div>
      <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
        <h2 style="color:#1F3A93;margin:0 0 16px">You've been invited to your Client Portal</h2>
        <p style="color:#374151;margin:0 0 8px">Hi <strong>${clientName}</strong>,</p>
        <p style="color:#374151;margin:0 0 20px">
          <strong>${agencyName}</strong> has set up a private portal for you. Inside you can:
        </p>
        <ul style="color:#374151;margin:0 0 24px;padding-left:20px;line-height:1.9">
          <li>View your live website details</li>
          <li>Review your signed agreement</li>
          <li>See before &amp; after comparisons</li>
          <li>Submit support requests</li>
        </ul>
        <p style="text-align:center;margin:28px 0">
          <a href="${inviteUrl}"
             style="background:#1F3A93;color:#fff;padding:14px 36px;border-radius:8px;
                    text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
            Set Your Password &amp; Access Portal
          </a>
        </p>
        <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;text-align:center">
          This invitation expires in 24 hours. If you weren't expecting this email you can safely ignore it.
        </p>
        <hr style="border:none;border-top:1px solid #f0f0f0;margin:20px 0">
        <p style="color:#9ca3af;font-size:12px;margin:0">${agencyName} &nbsp;·&nbsp; support@noveliotech.com</p>
      </div>
    </div>`

  try {
    if (provider.provider === 'resend') {
      const resend = new Resend(provider.api_key)
      await resend.emails.send({
        from:    `${agencyName} <${provider.from_email}>`,
        to:      [email],
        subject: `You've been invited to your client portal – ${agencyName}`,
        html,
      })
    } else {
      const from = provider.provider === 'gmail' ? provider.username : provider.from_email
      const t = nodemailer.createTransport({
        host: provider.host, port: provider.port, secure: provider.secure,
        auth: { user: provider.username, pass: provider.password },
      })
      await t.sendMail({
        from:    `${agencyName} <${from}>`,
        to:      email,
        subject: `You've been invited to your client portal – ${agencyName}`,
        html,
      })
    }
  } catch (e: any) {
    console.error('Invite email send error:', e.message)
    return NextResponse.json({ error: `Invite link created but email failed: ${e.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
