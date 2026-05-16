import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['admin', 'agent', 'sales_agent'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — only admins and agents can send invites' }, { status: 403 })
  }

  const body = await req.json()
  const { email, full_name, lead_id } = body

  if (!email || !lead_id) {
    return NextResponse.json({ error: 'email and lead_id are required' }, { status: 400 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server' }, { status: 500 })
  }

  if (!process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not configured on the server' }, { status: 500 })
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/set-password`

  const { error } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
    data: {
      role:      'client',
      lead_id,
      full_name: full_name ?? email.split('@')[0],
    },
    redirectTo,
  })

  if (error) {
    // Make common Supabase errors actionable
    const msg = error.message ?? ''

    if (msg.toLowerCase().includes('already been registered') || msg.toLowerCase().includes('already registered')) {
      return NextResponse.json({
        error: `This email (${email}) already has an account. If they need a new link, ask them to use the login page.`,
      }, { status: 400 })
    }

    if (msg.toLowerCase().includes('redirect')) {
      return NextResponse.json({
        error: `Redirect URL not allowed. In your Supabase project go to Authentication → URL Configuration → Redirect URLs and add: ${redirectTo}`,
      }, { status: 500 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
