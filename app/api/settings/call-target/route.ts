import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Admin-only read/write of the daily call target (app_settings.daily_call_target).
// app_settings holds secrets and has no client write policy, so writes go through
// the service client here, gated on the caller's admin role.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { error: null }
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()
  const { data } = await service.from('app_settings').select('value').eq('key', 'daily_call_target').single()
  return NextResponse.json({ target: Number(data?.value) || 50 })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const target = Math.trunc(Number(body?.target))
  if (!Number.isFinite(target) || target < 1 || target > 1000) {
    return NextResponse.json({ error: 'Target must be a whole number between 1 and 1000.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('app_settings')
    .upsert({ key: 'daily_call_target', value: String(target) }, { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ target })
}
