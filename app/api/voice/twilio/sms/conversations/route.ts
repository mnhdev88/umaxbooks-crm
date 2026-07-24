import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchSmsConversations } from '@/lib/sms-conversations'

/**
 * GET /api/voice/twilio/sms/conversations — the SMS inbox list (one summary per lead,
 * latest message wins), scoped to the caller's role. Polled by the inbox to surface new
 * replies. Reads with the authed session client so RLS + the sales-agent scoping apply.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const conversations = await fetchSmsConversations(supabase, {
    userId: user.id,
    role: profile?.role || '',
  })

  return NextResponse.json({ conversations })
}
