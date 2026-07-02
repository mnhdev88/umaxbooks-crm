import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * POST /api/voice/twilio/disposition — save the agent's post-call outcome + notes.
 *
 * Called from the dialer widget's wrap-up form when a live call ends. Upserts onto the
 * call's voice_calls row (keyed by the browser-side CallSid, which matches the parent
 * CallSid the status webhook uses, so the two merge regardless of arrival order) and
 * rolls the outcome onto the lead.
 *
 * Auth: requires a logged-in staff session; the write itself uses the service client
 * because voice_calls is service-role-write (RLS allows staff SELECT only).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    callSid?: string
    leadId?: string
    interested?: 'yes' | 'no' | 'maybe' | null
    voicemail?: boolean
    doNotCall?: boolean
    notes?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.callSid && !body.leadId) {
    return NextResponse.json({ error: 'Need callSid or leadId' }, { status: 400 })
  }

  const interested = body.interested ?? null
  const voicemail = !!body.voicemail
  const doNotCall = !!body.doNotCall
  const notes = body.notes?.trim() || null

  try {
    const svc = createServiceClient()

    if (body.callSid) {
      const callRow: Record<string, unknown> = {
        call_id: body.callSid,
        lead_id: body.leadId ?? null,
        agent_user_id: user.id,
        provider: 'twilio',
        direction: 'outbound',
        interested,
        do_not_call: doNotCall,
        notes,
      }
      // Only stamp answered_by when the agent marks voicemail, so it overrides the status
      // webhook's default of 'human'. Omitting it otherwise preserves the webhook value
      // (upsert only touches provided columns).
      if (voicemail) callRow.answered_by = 'voicemail'

      await svc
        .from('voice_calls')
        .upsert(callRow, { onConflict: 'call_id', ignoreDuplicates: false })
    }

    if (body.leadId) {
      const leadUpdate: Record<string, unknown> = {
        last_call_outcome: voicemail ? 'voicemail' : interested ?? 'completed',
        last_call_at: new Date().toISOString(),
      }
      if (doNotCall) leadUpdate.do_not_call = true
      await svc.from('leads').update(leadUpdate).eq('id', body.leadId)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[voice/twilio/disposition] failed', e)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
