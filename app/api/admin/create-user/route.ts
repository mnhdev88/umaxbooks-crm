import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  // ── 1. Verify caller is an authenticated admin ──────────────────────────
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

  const { data: profile, error: profileErr } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (profileErr) return NextResponse.json({ error: `Profile error: ${profileErr.message}` }, { status: 500 })
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 })

  // ── 2. Validate body ─────────────────────────────────────────────────────
  const { email, full_name, password, role } = await req.json()

  if (!email?.trim() || !full_name?.trim() || !password?.trim() || !role) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local' }, { status: 500 })

  // ── 3. Create auth user via GoTrue REST API directly ─────────────────────
  const gotrue = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`
  const authRes = await fetch(gotrue, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), role },
    }),
  })

  const authJson = await authRes.json()

  if (!authRes.ok) {
    const msg = authJson.msg || authJson.message || authJson.error_description || JSON.stringify(authJson)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const newUserId: string = authJson.id

  // ── 4. Upsert profile row (trigger may have already created it) ───────────
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await admin.from('profiles').upsert({
    id: newUserId,
    email: email.trim(),
    full_name: full_name.trim(),
    role,
  })

  return NextResponse.json({ success: true, userId: newUserId, email, full_name, role })
}
