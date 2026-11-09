import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { buildRawMessage, sendRawMessage } from '@/lib/google/gmail'
import { isWorkspaceEmail, workspaceConfigError } from '@/lib/google/workspace'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { provider, host, port, secure, username, password, api_key, from_email, from_name, test_to } = body

  const to = test_to || user.email!

  // Gmail SMTP ignores custom from address — must match authenticated account
  const effectiveFrom = provider === 'gmail'
    ? `${from_name || 'Noveliotech CRM'} <${username}>`
    : `${from_name || 'Noveliotech CRM'} <${from_email}>`

  try {
    if (provider === 'google_workspace') {
      // Proves the service account can impersonate a mailbox: sends from the admin's own
      const configError = workspaceConfigError()
      if (configError) throw new Error(configError)
      const mailbox = user.email!.toLowerCase()
      if (!isWorkspaceEmail(mailbox)) {
        throw new Error(`Your login (${mailbox}) is not on the Workspace domain, so it can't be used for the test`)
      }
      const raw = await buildRawMessage({
        from: mailbox,
        to,
        subject: 'Noveliotech CRM — Gmail (Workspace) Test',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#f97316;">Email Test Successful</h2>
          <p>The CRM can send as <strong>${mailbox}</strong> through Google Workspace.</p>
          <p style="color:#94a3b8;font-size:13px;">Sent via Noveliotech CRM Settings</p>
        </div>`,
      })
      await sendRawMessage(mailbox, raw)
    } else if (provider === 'resend') {
      const resend = new Resend(api_key)
      const { error } = await resend.emails.send({
        from: effectiveFrom,
        to,
        subject: 'Noveliotech CRM — Email Provider Test',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#f97316;">Email Test Successful</h2>
          <p>Your <strong>Resend</strong> provider is connected and working.</p>
          <p style="color:#94a3b8;font-size:13px;">Sent via Noveliotech CRM Settings</p>
        </div>`,
      })
      if (error) throw new Error(error.message)
    } else {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Boolean(secure),
        auth: { user: username, pass: password },
      })
      await transporter.verify()
      await transporter.sendMail({
        from: effectiveFrom,
        to,
        subject: 'Noveliotech CRM — Email Provider Test',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#f97316;">Email Test Successful</h2>
          <p>Your <strong>${provider === 'gmail' ? 'Gmail' : provider === 'aws_ses' ? 'AWS SES' : 'SMTP'}</strong> provider is connected and working.</p>
          <p style="color:#64748b;font-size:13px;">Sent from: ${effectiveFrom}</p>
          <p style="color:#94a3b8;font-size:13px;">Sent via Noveliotech CRM Settings</p>
        </div>`,
      })
    }
    return NextResponse.json({ success: true, sent_to: to })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
