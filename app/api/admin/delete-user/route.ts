import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  if (userId === user.id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Re-home everything the departing user authored onto the acting admin, then
  // delete the account. reassign_and_delete_user (migration 066) discovers every
  // restrict/no-action FK to profiles(id) from the catalog — so it can't miss a
  // table the way a hand-maintained list does — reassigns them to the heir, and
  // deletes auth.users (cascading the profile + all ON DELETE CASCADE children:
  // notifications, follow_ups, round_robin_agents, push_subscriptions, chat).
  const { error: delErr } = await admin.rpc('reassign_and_delete_user', {
    p_target: userId,
    p_heir: user.id,
  })

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
