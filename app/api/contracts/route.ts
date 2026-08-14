import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildInstallmentPlan, sanitizeScopeItems, DEFAULT_SCOPE_ITEMS } from '@/lib/contract-plan'
import { CONTRACT_LINK_DAYS } from '@/lib/contract-expiry'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ error: 'Missing lead_id' }, { status: 400 })

  const service = createServiceClient()
  const { data, error } = await service
    .from('contracts')
    .select('id,status,business_name,client_email,package,total_amount,scope_items,sent_at,signed_at,signed_pdf_url,signing_token')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  // Don't swallow this: a select that fails (a column the deployed DB is missing,
  // say) used to fall through to [] and render as "No contracts sent yet" — the
  // agreements looked deleted rather than unreadable.
  if (error) {
    console.error('Contracts fetch error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ contracts: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // Keep this in step with ContractTab's canManage — a role that sees the button
  // and then gets a 403 on submit is worse than not showing the button at all.
  const CAN_SEND = ['admin', 'sales_agent', 'sales_manager']
  if (!CAN_SEND.includes(profile?.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { lead_id, ...fields } = body

  // Scope of Services, snapshotted like the payment schedule below: what the
  // client is shown and agrees to must not shift if the package defaults change
  // afterwards. Sanitized here rather than trusted from the browser.
  const scope = sanitizeScopeItems(fields.scope_items)
  fields.scope_items = scope.length > 0 ? scope : [...DEFAULT_SCOPE_ITEMS]

  // Rebuild the installment plan server-side from the three inputs. The browser's
  // derived numbers are never trusted — this is the amount the client will be
  // asked to agree to, and it's frozen into payment_schedule so a later change to
  // the maths can't retroactively alter a signed agreement.
  if (fields.payment_type === 'Installment') {
    const plan = buildInstallmentPlan({
      total:     Number(fields.total_amount),
      down:      Number(fields.down_payment) || 0,
      months:    Number(fields.installment_count),
      startDate: fields.start_date,
    })
    if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 })
    fields.down_payment             = plan.down
    fields.installment_count        = plan.months
    fields.installment_amount       = plan.monthly
    fields.final_installment_amount = plan.finalMonthly
    fields.payment_schedule         = plan.schedule
  } else {
    fields.down_payment             = null
    fields.installment_count        = null
    fields.installment_amount       = null
    fields.final_installment_amount = null
    fields.payment_schedule         = null
  }

  const service = createServiceClient()
  const { data: contract, error } = await service
    .from('contracts')
    .insert({ lead_id, created_by: user.id, ...fields })
    .select('id,signing_token,client_email,business_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Send signing link email via default provider
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (provider) {
    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin
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
        await resend.emails.send({
          from: `${agencyName} <${provider.from_email}>`,
          to: [contract.client_email],
          subject: `Service Agreement – ${agencyName}`,
          html,
        })
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
    }
  }

  await service.from('activity_logs').insert({
    lead_id,
    user_id: user.id,
    action: 'Contract Sent',
    details: `Service agreement sent to ${contract.client_email}`,
  })

  return NextResponse.json({ success: true })
}

/**
 * PATCH /api/contracts — cancel an awaiting contract: { id, action: 'cancel' }.
 *
 * The record stays (it's an audit trail of what was offered) but the signing link dies
 * immediately; the client's page shows "Agreement Cancelled". Only `sent` contracts can
 * be cancelled — a signed agreement is a done deal, and un-cancelling doesn't exist:
 * stale terms get a fresh contract, not a revived link.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // Same roles that can send one — see POST above and ContractTab's canManage.
  const CAN_SEND = ['admin', 'sales_agent', 'sales_manager']
  if (!CAN_SEND.includes(profile?.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, action } = await req.json().catch(() => ({}))
  if (action !== 'cancel' || !id) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const service = createServiceClient()
  // The status filter makes this a no-op on signed/cancelled rows rather than trusting
  // the browser's view of the state, which may be minutes old.
  const { data: cancelled, error } = await service
    .from('contracts')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'sent')
    .select('id,lead_id,client_email,business_name')
    .single()

  if (error || !cancelled) {
    return NextResponse.json({ error: 'Contract not found or no longer awaiting signature' }, { status: 409 })
  }

  await service.from('activity_logs').insert({
    lead_id: cancelled.lead_id,
    user_id: user.id,
    action: 'Contract Cancelled',
    details: `Awaiting agreement for ${cancelled.client_email} cancelled — signing link deactivated`,
  })

  return NextResponse.json({ success: true })
}
