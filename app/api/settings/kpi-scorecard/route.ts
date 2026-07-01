import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Admin-only read/write of the KPI scorecard config (targets, weightages, active).
// Reads are public to authenticated users via RLS, but writes go through the
// service client here, gated on the caller's admin role.

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
  const { data } = await service.from('kpi_scorecard_config').select('*').order('sort_order')
  return NextResponse.json({ config: data ?? [] })
}

// Body: { rows: [{ kpi_key, target, weightage, active }] } — partial updates per KPI.
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return NextResponse.json({ error: 'No rows to update.' }, { status: 400 })

  const service = createServiceClient()
  for (const r of rows) {
    if (typeof r?.kpi_key !== 'string') continue
    const target = Number(r.target)
    const weightage = Number(r.weightage)
    if (!Number.isFinite(target) || target < 0) {
      return NextResponse.json({ error: `Invalid target for ${r.kpi_key}.` }, { status: 400 })
    }
    if (!Number.isFinite(weightage) || weightage < 0 || weightage > 100) {
      return NextResponse.json({ error: `Weightage for ${r.kpi_key} must be 0–100.` }, { status: 400 })
    }
    const { error: dbError } = await service
      .from('kpi_scorecard_config')
      .update({ target, weightage, active: r.active !== false, updated_at: new Date().toISOString() })
      .eq('kpi_key', r.kpi_key)
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  const { data } = await service.from('kpi_scorecard_config').select('*').order('sort_order')
  return NextResponse.json({ config: data ?? [] })
}
