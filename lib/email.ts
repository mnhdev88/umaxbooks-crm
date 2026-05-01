import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<{ data: any; error: string | null }> {
  const supabase = createServiceClient()

  const { data: provider } = await supabase
    .from('email_providers')
    .select('*')
    .eq('is_default', true)
    .eq('is_active', true)
    .single()

  if (provider) {
    const from = `${provider.from_name} <${provider.from_email}>`
    try {
      if (provider.provider === 'resend') {
        const resend = new Resend(provider.api_key)
        const { data, error } = await resend.emails.send({ from, to, subject, html })
        return { data, error: error?.message ?? null }
      }

      const transporter = nodemailer.createTransport({
        host: provider.host,
        port: provider.port,
        secure: provider.secure,
        auth: { user: provider.username, pass: provider.password },
      })
      const info = await transporter.sendMail({ from, to, subject, html })
      return { data: { id: info.messageId }, error: null }
    } catch (err: any) {
      return { data: null, error: err.message }
    }
  }

  // Fallback: env RESEND_API_KEY
  if (!process.env.RESEND_API_KEY) {
    return { data: null, error: 'No email provider configured' }
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'UMAX CRM'
    const { data, error } = await resend.emails.send({
      from: `${agencyName} <${process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com'}>`,
      to,
      subject,
      html,
    })
    return { data, error: error?.message ?? null }
  } catch (err: any) {
    return { data: null, error: err.message }
  }
}
