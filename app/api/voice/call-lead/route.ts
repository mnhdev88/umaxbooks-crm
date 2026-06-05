import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { startOutboundCall } from '@/lib/voice/bland'

/**
 * POST /api/voice/call-lead  — staff-triggered AI voice call from the lead detail UI.
 *
 * Session-authenticated (logged-in staff only). The lead's phone/name/company are
 * read server-side from the DB — never trusted from the client. Whitelisted in
 * proxy.ts under /api/voice, but enforces its own auth below.
 *
 * Body: { leadId: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leadId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.leadId) {
    return NextResponse.json({ error: 'Missing "leadId"' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: lead } = await service
    .from('leads')
    .select('id, name, company_name, phone')
    .eq('id', body.leadId)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.phone) {
    return NextResponse.json({ error: 'This lead has no phone number on file.' }, { status: 422 })
  }

  const result = await startOutboundCall({
    phone: lead.phone,
    name: lead.name,
    company: lead.company_name,
    leadId: lead.id,
  })

  if (!result.ok) {
    console.error('[voice/call-lead] Bland call failed:', result.error, result.body)
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }

  // Record that a call was placed (the webhook later logs the outcome).
  try {
    await service.from('activity_logs').insert({
      lead_id: lead.id,
      user_id: user.id,
      action: 'AI Voice Call Initiated',
      details: `Outbound AI call placed to ${lead.phone}.${result.callId ? ` Call id: ${result.callId}.` : ''}`,
    })
  } catch {}

  return NextResponse.json({ ok: true, callId: result.callId })
}
