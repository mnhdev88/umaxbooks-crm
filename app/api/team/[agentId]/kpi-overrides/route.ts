import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Per-user KPI scorecard overrides for one team member (backed by
// kpi_scorecard_user_overrides, migration 075). GET returns the user's
// *effective* config — global kpi_scorecard_config with their overrides merged
// in — plus the global defaults per row so the editor can mark customised KPIs.
// POST saves a full 7-row grid: rows that differ from the global defaults are
// upserted as overrides, rows that match them are deleted (i.e. revert to
// inheriting), so later changes to a global default keep flowing to everyone
// who wasn't customised. DELETE resets the user to the global defaults.
//
// Editing is allowed for admins, and for a sales manager on agents of their own
// team (not on themselves — their targets are set by an admin). Viewing follows
// the team profile page: admins, or a manager viewing their team / themselves.

interface Ctx { params: Promise<{ agentId: string }> }

async function loadAccess(agentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: me } = await supabase.from('profiles').select('id, role').eq('id', user.id).single()
  const { data: agent } = await supabase.from('profiles').select('id, role, manager_id').eq('id', agentId).single()
  if (!me || !agent) return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) }

  const isAdmin = me.role === 'admin'
  const isTheirManager = me.role === 'sales_manager' && agent.manager_id === me.id
  const canView = isAdmin || isTheirManager || (me.role === 'sales_manager' && agent.id === me.id)
  const canEdit = isAdmin || (isTheirManager && agent.id !== me.id)
  if (!canView) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { error: null, supabase, userId: user.id, canEdit }
}

async function effectiveRows(supabase: Awaited<ReturnType<typeof createClient>>, agentId: string) {
  const [{ data: config }, { data: overrides }] = await Promise.all([
    supabase.from('kpi_scorecard_config').select('*').order('sort_order'),
    supabase.from('kpi_scorecard_user_overrides').select('kpi_key, target, weightage, active').eq('user_id', agentId),
  ])
  const byKey = new Map((overrides ?? []).map(o => [o.kpi_key, o]))
  return (config ?? []).map(c => {
    const o = byKey.get(c.kpi_key)
    return {
      kpi_key: c.kpi_key,
      stage: c.stage,
      label: c.label,
      unit: c.unit,
      target_basis: c.target_basis,
      target: Number(o ? o.target : c.target),
      weightage: Number(o ? o.weightage : c.weightage),
      active: o ? o.active : c.active,
      overridden: Boolean(o),
      default_target: Number(c.target),
      default_weightage: Number(c.weightage),
      default_active: c.active,
    }
  })
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { agentId } = await params
  const access = await loadAccess(agentId)
  if (access.error) return access.error

  const rows = await effectiveRows(access.supabase, agentId)
  return NextResponse.json({ rows, canEdit: access.canEdit })
}

// Body: { rows: [{ kpi_key, target, weightage, active }] } — the full grid.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { agentId } = await params
  const access = await loadAccess(agentId)
  if (access.error) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return NextResponse.json({ error: 'No rows to save.' }, { status: 400 })

  const { data: config } = await access.supabase.from('kpi_scorecard_config').select('*')
  const configByKey = new Map((config ?? []).map(c => [c.kpi_key, c]))

  const service = createServiceClient()
  for (const r of rows) {
    const base = typeof r?.kpi_key === 'string' ? configByKey.get(r.kpi_key) : undefined
    if (!base) continue
    const target = Number(r.target)
    const weightage = Number(r.weightage)
    const active = r.active !== false
    if (!Number.isFinite(target) || target < 0) {
      return NextResponse.json({ error: `Invalid target for ${r.kpi_key}.` }, { status: 400 })
    }
    if (!Number.isFinite(weightage) || weightage < 0 || weightage > 100) {
      return NextResponse.json({ error: `Weightage for ${r.kpi_key} must be 0–100.` }, { status: 400 })
    }

    const matchesDefault =
      target === Number(base.target) && weightage === Number(base.weightage) && active === base.active
    const { error: dbError } = matchesDefault
      ? await service.from('kpi_scorecard_user_overrides').delete()
          .eq('user_id', agentId).eq('kpi_key', r.kpi_key)
      : await service.from('kpi_scorecard_user_overrides').upsert({
          user_id: agentId,
          kpi_key: r.kpi_key,
          target,
          weightage,
          active,
          updated_by: access.userId,
          updated_at: new Date().toISOString(),
        })
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  const out = await effectiveRows(access.supabase, agentId)
  return NextResponse.json({ rows: out, canEdit: access.canEdit })
}

// Reset: drop every override so the user inherits the global defaults again.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { agentId } = await params
  const access = await loadAccess(agentId)
  if (access.error) return access.error
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const service = createServiceClient()
  const { error: dbError } = await service.from('kpi_scorecard_user_overrides').delete().eq('user_id', agentId)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  const rows = await effectiveRows(access.supabase, agentId)
  return NextResponse.json({ rows, canEdit: access.canEdit })
}
