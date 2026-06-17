import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'

export interface EmailAttachment {
  filename: string
  /** File contents. Buffer works for both Resend and nodemailer. */
  content: Buffer | string
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

export async function sendEmail({ to, subject, html, attachments }: SendEmailOptions): Promise<{ data: any; error: string | null }> {
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
        const { data, error } = await resend.emails.send({
          from, to, subject, html,
          ...(attachments?.length ? { attachments } : {}),
        })
        return { data, error: error?.message ?? null }
      }

      const transporter = nodemailer.createTransport({
        host: provider.host,
        port: provider.port,
        secure: provider.secure,
        auth: { user: provider.username, pass: provider.password },
      })
      const info = await transporter.sendMail({
        from, to, subject, html,
        ...(attachments?.length ? { attachments } : {}),
      })
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
    const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Noveliotech CRM'
    const { data, error } = await resend.emails.send({
      from: `${agencyName} <${process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com'}>`,
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    })
    return { data, error: error?.message ?? null }
  } catch (err: any) {
    return { data: null, error: err.message }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Templated email to a lead — used by the post-call auto-outreach (and reusable
// elsewhere). Renders an email_templates row against the lead, sends it, and logs
// the send to email_sends + activity_logs. Eligibility (has email, not
// do_not_call / unsubscribed, once-guard) is the CALLER's responsibility.
// ────────────────────────────────────────────────────────────────────────────

interface TemplateLead {
  id: string
  name: string | null
  company_name: string | null
  email: string
  city?: string | null
  business_type?: string | null
  gmb_category?: string | null
  /** When set, agent placeholders render from this profile; otherwise agency defaults. */
  assigned_agent_id?: string | null
}

interface TemplateAgent {
  full_name: string | null
  email: string | null
}

/** Replace every placeholder convention used across our templates. */
function fillPlaceholders(text: string, lead: TemplateLead, agent?: TemplateAgent | null): string {
  const company      = lead.company_name || lead.name || 'your business'
  const fullName     = lead.name || 'there'
  const firstName    = (lead.name || '').trim().split(/\s+/)[0] || 'there'
  const city         = lead.city || 'your area'
  // Explicit business_type wins; fall back to the Google Business category, then a safe generic.
  const businessType = lead.business_type || lead.gmb_category || 'local'
  // Agent/agency placeholders — same values ComposeModal uses, so templates render
  // identically whether sent by hand or auto-sent (no logged-in user on this path).
  const agencyName    = process.env.NEXT_PUBLIC_AGENCY_NAME    || 'Novelio Technologies'
  const agencyPhone   = process.env.NEXT_PUBLIC_AGENCY_PHONE   || ''
  const agencyWebsite = process.env.NEXT_PUBLIC_AGENCY_WEBSITE || 'noveliotech.com'
  return text
    .replace(/\{\{\s*company_name\s*\}\}/gi, company)
    .replace(/\{\{\s*business_name\s*\}\}/gi, company)
    .replace(/\{\{\s*client_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*city\s*\}\}/gi, city)
    .replace(/\{\{\s*business_type\s*\}\}/gi, businessType)
    .replace(/\{\{\s*agent_name\s*\}\}/gi, agent?.full_name || agencyName)
    .replace(/\{\{\s*agent_email\s*\}\}/gi, agent?.email || '')
    .replace(/\{\{\s*agent_phone\s*\}\}/gi, agencyPhone)
    .replace(/\{\{\s*agent_whatsapp\s*\}\}/gi, process.env.NEXT_PUBLIC_AGENT_WHATSAPP || '')
    .replace(/\{\{\s*agency_name\s*\}\}/gi, agencyName)
    .replace(/\{\{\s*agency_website\s*\}\}/gi, agencyWebsite)
    .replace(/\{\{\s*report_url\s*\}\}/gi, '')
}

/**
 * Look up a template by name (case-insensitive, with a "cold outreach" fallback),
 * render it for the lead, send it, and record the send. Returns whether it sent.
 */
export async function sendTemplateEmailToLead(opts: {
  lead: TemplateLead
  templateName: string
  /** Free-text reason for the activity-log entry, e.g. "after AI voice call". */
  context?: string
}): Promise<{ sent: boolean; error?: string }> {
  const { lead, templateName, context } = opts
  if (!lead.email) return { sent: false, error: 'lead has no email' }

  const supabase = createServiceClient()

  // Exact (case-insensitive) name first, then a tolerant "cold outreach" match.
  let { data: template } = await supabase
    .from('email_templates')
    .select('subject, html_body')
    .ilike('name', templateName)
    .limit(1)
    .maybeSingle()

  if (!template) {
    const fallback = await supabase
      .from('email_templates')
      .select('subject, html_body')
      .ilike('name', '%cold outreach%')
      .order('created_at')
      .limit(1)
      .maybeSingle()
    template = fallback.data
  }

  if (!template) return { sent: false, error: `template "${templateName}" not found` }

  // Resolve the lead's assigned agent for {{agent_*}} placeholders. Callers may pass
  // assigned_agent_id; otherwise look it up. Falls back to agency defaults if none.
  let agent: TemplateAgent | null = null
  try {
    let agentId = lead.assigned_agent_id
    if (agentId === undefined) {
      const { data } = await supabase
        .from('leads')
        .select('assigned_agent_id')
        .eq('id', lead.id)
        .maybeSingle()
      agentId = data?.assigned_agent_id ?? null
    }
    if (agentId) {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', agentId)
        .maybeSingle()
      agent = data
    }
  } catch (e) {
    console.error('[email] sendTemplateEmailToLead: agent lookup failed, using agency defaults', e)
  }

  const subject = fillPlaceholders(template.subject || '', lead, agent)
  const html    = fillPlaceholders(template.html_body || '', lead, agent)

  const { error } = await sendEmail({ to: lead.email, subject, html })
  if (error) return { sent: false, error }

  const sentAt = new Date().toISOString()

  // History + timeline (best-effort — a logging hiccup must not "unsend" the email).
  try {
    const { data: provider } = await supabase
      .from('email_providers')
      .select('from_email')
      .eq('is_default', true)
      .maybeSingle()

    await supabase.from('email_sends').insert({
      lead_id:    lead.id,
      sent_by:    null,
      from_email: provider?.from_email || process.env.RESEND_FROM_EMAIL || 'noreply@noveliotech.com',
      to_email:   lead.email,
      subject,
      html_body:  html,
      status:     'sent',
      sent_at:    sentAt,
    })
    await supabase.from('activity_logs').insert({
      lead_id: lead.id,
      user_id: null,
      action:  'Auto Cold-Outreach Email Sent',
      details: `Sent "${templateName}" to ${lead.email}${context ? ` (${context})` : ''}.`,
    })

    // Promote New leads to Contacted on first email — mirrors sendLeadEmail().
    await supabase.from('leads').update({ status: 'Contacted' }).eq('id', lead.id).eq('status', 'New')
  } catch (e) {
    console.error('[email] sendTemplateEmailToLead: send succeeded but logging failed', e)
  }

  return { sent: true }
}
