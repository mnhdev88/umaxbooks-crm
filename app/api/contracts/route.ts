import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildInstallmentPlan, sanitizeScopeItems, sanitizeDueDates, DEFAULT_SCOPE_ITEMS } from '@/lib/contract-plan'
import { contractLinkExpired } from '@/lib/contract-expiry'
import { sendSigningEmail } from '@/lib/contract-email'
import { contractOwnerIds, contractInScope } from '@/lib/contract-access'

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
  // Due dates the rep moved off the generated cadence. Not a column of its own —
  // it only steers the schedule below, so it never reaches the insert.
  const { due_dates, ...rest } = fields as Record<string, unknown>
  const fieldsToInsert = rest as Record<string, any>

  if (fieldsToInsert.payment_type === 'Installment') {
    const plan = buildInstallmentPlan({
      total:     Number(fieldsToInsert.total_amount),
      down:      Number(fieldsToInsert.down_payment) || 0,
      months:    Number(fieldsToInsert.installment_count),
      startDate: fieldsToInsert.start_date,
      dueDates:  sanitizeDueDates(due_dates, Number(fieldsToInsert.installment_count)),
    })
    if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 })
    fieldsToInsert.down_payment             = plan.down
    fieldsToInsert.installment_count        = plan.months
    fieldsToInsert.installment_amount       = plan.monthly
    fieldsToInsert.final_installment_amount = plan.finalMonthly
    fieldsToInsert.payment_schedule         = plan.schedule
  } else {
    fieldsToInsert.down_payment             = null
    fieldsToInsert.installment_count        = null
    fieldsToInsert.installment_amount       = null
    fieldsToInsert.final_installment_amount = null
    fieldsToInsert.payment_schedule         = null
  }

  const service = createServiceClient()
  const { data: contract, error } = await service
    .from('contracts')
    .insert({ lead_id, created_by: user.id, ...fieldsToInsert })
    .select('id,signing_token,client_email,business_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Send signing link email via default provider
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin
  await sendSigningEmail(service, contract, origin)

  await service.from('activity_logs').insert({
    lead_id,
    user_id: user.id,
    action: 'Contract Sent',
    details: `Service agreement sent to ${contract.client_email}`,
  })

  return NextResponse.json({ success: true })
}

/**
 * PATCH /api/contracts — act on an awaiting contract: { id, action: 'cancel' | 'resend' }.
 *
 * cancel: the record stays (it's an audit trail of what was offered) but the signing link
 * dies immediately; the client's page shows "Agreement Cancelled". Only `sent` contracts
 * can be cancelled — a signed agreement is a done deal, and un-cancelling doesn't exist:
 * stale terms get a fresh contract, not a revived link.
 *
 * resend: emails the same signing link again. It does NOT move sent_at, so the link's
 * 7-day window is unchanged — an expired link needs a new contract, not a nudge.
 *
 * Both are limited to contracts inside the caller's scope (lib/contract-access).
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('id,role').eq('id', user.id).single()
  // Same roles that can send one — see POST above and ContractTab's canManage.
  const CAN_SEND = ['admin', 'sales_agent', 'sales_manager']
  if (!profile || !CAN_SEND.includes(profile.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, action } = await req.json().catch(() => ({}))
  if ((action !== 'cancel' && action !== 'resend') || !id) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const service = createServiceClient()
  const { data: existing } = await service
    .from('contracts')
    .select('id,lead_id,status,sent_at,created_at,created_by,client_email,business_name,signing_token,lead:leads(assigned_agent_id)')
    .eq('id', id)
    .maybeSingle()

  const owners = await contractOwnerIds(service, profile)
  const leadOwner = (existing?.lead as any)?.assigned_agent_id ?? null
  if (!existing || !contractInScope(owners, { created_by: existing.created_by, lead_owner: leadOwner })) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  }

  if (action === 'resend') {
    if (existing.status !== 'sent' || contractLinkExpired(existing)) {
      return NextResponse.json({ error: 'Only contracts still awaiting signature can be resent' }, { status: 409 })
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin
    const mailError = await sendSigningEmail(service, existing, origin)
    if (mailError) return NextResponse.json({ error: `Email not sent: ${mailError}` }, { status: 502 })

    await service.from('activity_logs').insert({
      lead_id: existing.lead_id,
      user_id: user.id,
      action: 'Contract Resent',
      details: `Signing link emailed again to ${existing.client_email}`,
    })
    return NextResponse.json({ success: true })
  }

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
