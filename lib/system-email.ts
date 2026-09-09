import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Send a transactional email that belongs to the SYSTEM rather than to a rep.
 *
 * /api/email/send is the rep's path: it needs a session, a chosen provider and
 * a lead to log the send against. An access code has none of those — it is
 * triggered by an anonymous visitor at the front door — so this takes the same
 * route /api/contracts already takes for the agreement email: the default
 * active provider row, Resend or SMTP, and no email_sends row (a login code is
 * not correspondence and shouldn't clutter the lead's email history).
 */
export interface SystemEmail {
  to: string
  subject: string
  html: string
}

export async function sendSystemEmail(
  service: SupabaseClient,
  { to, subject, html }: SystemEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (!provider) return { ok: false, error: 'No default email provider is configured' }

  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'

  try {
    if (provider.provider === 'resend') {
      const resend = new Resend(provider.api_key)
      const { error } = await resend.emails.send({
        from: `${agencyName} <${provider.from_email}>`,
        to: [to],
        subject,
        html,
      })
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }

    const from = provider.provider === 'gmail' ? provider.username : provider.from_email
    const transporter = nodemailer.createTransport({
      host:   provider.host,
      port:   provider.port,
      secure: provider.secure,
      auth:   { user: provider.username, pass: provider.password },
    })
    await transporter.sendMail({ from: `${agencyName} <${from}>`, to, subject, html })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed' }
  }
}

/** The access-code email. Deliberately plain — codes get read on a phone. */
export function accessCodeEmail(code: string, business: string | null): { subject: string; html: string } {
  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'
  return {
    subject: `${code} is your access code`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(90deg,#1F3A93,#4a6cf7,#b8902a);height:5px;border-radius:4px 4px 0 0"></div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
          <h2 style="color:#1F3A93;margin:0 0 8px;font-size:19px">Your access code</h2>
          <p style="color:#374151;margin:0 0 22px;font-size:14px">
            Use this code to open ${business ? `<strong>${business}</strong>'s` : 'your'} documents.
          </p>
          <p style="text-align:center;margin:0 0 22px">
            <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;background:#f3f4f6;border-radius:10px;padding:14px 22px">${code}</span>
          </p>
          <p style="color:#6b7280;font-size:13px;margin:0 0 6px">This code expires in 10 minutes.</p>
          <p style="color:#9ca3af;font-size:12px;margin:0">
            Didn't request it? You can ignore this email — nobody can open your documents without the code.
          </p>
          <hr style="border:none;border-top:1px solid #f0f0f0;margin:22px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">${agencyName} · support@noveliotech.com</p>
        </div>
      </div>`,
  }
}
