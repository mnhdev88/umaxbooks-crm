import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONTRACT_LINK_DAYS } from '@/lib/contract-expiry'

/**
 * Emails the client their signing link through the default email provider. Shared by
 * the first send (POST /api/contracts) and a resend from the Contracts page, so the
 * two can't drift into different wording.
 *
 * Returns an error string rather than throwing: the contract row already exists by
 * the time this runs, and a mail hiccup shouldn't make it look like nothing was sent.
 */
export async function sendSigningEmail(
  service: SupabaseClient,
  contract: { signing_token: string; client_email: string; business_name: string },
  origin: string,
): Promise<string | null> {
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (!provider) return 'No default email provider is configured'

  const signingUrl = `${origin}/sign/${contract.signing_token}`
  const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'
  const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(90deg,#1F3A93,#4a6cf7);height:5px;border-radius:4px 4px 0 0"></div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
          <h2 style="color:#1F3A93;margin:0 0 8px">Your Service Agreement is Ready</h2>
          <p style="color:#374151;margin:0 0 24px">Dear <strong>${contract.business_name}</strong>,</p>
          <p style="color:#374151;margin:0 0 24px">
            <strong>${agencyName}</strong> has prepared your service agreement. Please review and sign it by clicking the button below.
          </p>
          <p style="text-align:center;margin:32px 0">
            <a href="${signingUrl}" style="background:#1F3A93;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
              Review &amp; Sign Agreement
            </a>
          </p>
          <p style="color:#9ca3af;font-size:12px;margin:0 0 16px">Or copy this link:<br>${signingUrl}</p>
          <p style="color:#9ca3af;font-size:12px;margin:0">This link is valid for ${CONTRACT_LINK_DAYS} days. If it expires, just reply and we&rsquo;ll send a fresh agreement.</p>
          <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">${agencyName} · support@noveliotech.com</p>
        </div>
      </div>`

  try {
    if (provider.provider === 'resend') {
      const resend = new Resend(provider.api_key)
      const { error } = await resend.emails.send({
        from: `${agencyName} <${provider.from_email}>`,
        to: [contract.client_email],
        subject: `Service Agreement – ${agencyName}`,
        html,
      })
      if (error) throw new Error(error.message)
    } else {
      const from = provider.provider === 'gmail' ? provider.username : provider.from_email
      const transporter = nodemailer.createTransport({
        host: provider.host, port: provider.port, secure: provider.secure,
        auth: { user: provider.username, pass: provider.password },
      })
      await transporter.sendMail({
        from: `${agencyName} <${from}>`,
        to: contract.client_email,
        subject: `Service Agreement – ${agencyName}`,
        html,
      })
    }
  } catch (e: any) {
    console.error('Contract email error:', e.message)
    return e.message || 'Email failed to send'
  }
  return null
}
