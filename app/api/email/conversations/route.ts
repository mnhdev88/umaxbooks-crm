import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchEmailConversations } from '@/lib/email-conversations'

// GET — conversation list for the /emails inbox poll (same scoping as the page).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || ['developer', 'client', 'seo_agent'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const conversations = await fetchEmailConversations(supabase, { userId: user.id, role: profile.role })
  return NextResponse.json({ conversations })
}
