import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'

// SEO settings on a live site. An SEO agent may edit the sites assigned to them
// (RLS enforces that); only an admin may (re)assign a site to an agent.

const AGENT_FIELDS = [
  'seo_plan',
  'seo_check_frequency',
  'seo_started_at',
  'seo_auto_report',
  'seo_report_email',
  'target_keywords',
  'gsc_property',
  'gbp_url',
] as const

export async function PATCH(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase, profile } = guard

  const body = await req.json().catch(() => ({} as any))
  const { siteId, ...rest } = body
  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const field of AGENT_FIELDS) {
    if (field in rest) patch[field] = rest[field]
  }

  // Reassignment is an admin decision — an agent handing their own work to
  // someone else (or grabbing someone else's) should go through a manager.
  if ('assigned_seo_agent_id' in rest) {
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only an admin can assign an SEO agent' }, { status: 403 })
    }
    patch.assigned_seo_agent_id = rest.assigned_seo_agent_id || null
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('live_sites')
    .update(patch)
    .eq('id', siteId)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // No row back means RLS refused the write — the site isn't theirs.
  if (!data) return NextResponse.json({ error: 'Site not found or not yours' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
