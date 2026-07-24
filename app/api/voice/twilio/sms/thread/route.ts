import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/voice/twilio/sms/thread?leadId=… — the SMS conversation for a lead.
 *
 * Returns every text to/from the lead, oldest first, for the lead-page thread. Reads with
 * the authed session client so RLS (staff SELECT) applies — no service key needed. The
 * panel polls this while open to pull in replies that arrived via the incoming webhook.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leadId = req.nextUrl.searchParams.get('leadId')
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  const { data, error } = await supabase
    .from('sms_messages')
    .select('id, direction, from_number, to_number, body, num_media, status, error_code, agent_user_id, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[voice/twilio/sms/thread] query failed', error)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }

  return NextResponse.json({ messages: data ?? [] })
}
