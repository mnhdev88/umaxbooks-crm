import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'

// Work an issue: mark it fixed by hand, park it as ignored, reopen it, or leave
// a note. The monitor closes issues on its own when the site starts passing, so
// the manual path here is for fixes it can't see (a GBP edit, a redirect).

export async function PATCH(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase, profile } = guard

  const { id, status, notes } = await req.json().catch(() => ({} as any))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (status) {
    if (!['open', 'fixed', 'ignored'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = status
    if (status === 'fixed') {
      patch.fixed_at = new Date().toISOString()
      patch.fixed_by = profile.id
      // Hand-fixed, so the report can distinguish our work from the site
      // simply starting to pass on its own.
      patch.auto_fixed = false
    } else {
      // Reopening or parking clears the fix — otherwise it would still count
      // as "fixed this month" in the client report.
      patch.fixed_at = null
      patch.fixed_by = null
      patch.auto_fixed = false
    }
  }

  if (typeof notes === 'string') patch.notes = notes

  const { data, error } = await supabase
    .from('seo_issues')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Issue not found or not yours' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
