import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'

// The month's planned work per site. Completed tasks are what the client report
// lists under "work delivered", so completed_at is set/cleared with the status
// rather than being a separate field anyone has to remember.

const CATEGORIES = ['technical', 'content', 'gbp', 'backlinks', 'other']
const STATUSES   = ['todo', 'doing', 'done']

export async function POST(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase, profile } = guard

  const { siteId, title, category, dueDate, notes } = await req.json().catch(() => ({} as any))
  if (!siteId || !title?.trim()) {
    return NextResponse.json({ error: 'siteId and title required' }, { status: 400 })
  }
  if (category && !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  // lead_id is denormalised onto the task, so read it off the site we're told.
  const { data: site } = await supabase
    .from('live_sites')
    .select('id, lead_id')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('seo_tasks')
    .insert({
      site_id: site.id,
      lead_id: site.lead_id,
      title: title.trim(),
      category: category ?? 'technical',
      due_date: dueDate || null,
      notes: notes || null,
      assigned_to: profile.id,
      created_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase } = guard

  const { id, status, title, category, dueDate, notes } = await req.json().catch(() => ({} as any))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (status) {
    if (!STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    patch.status = status
    patch.completed_at = status === 'done' ? new Date().toISOString() : null
  }
  if (typeof title === 'string' && title.trim()) patch.title = title.trim()
  if (category) {
    if (!CATEGORIES.includes(category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    patch.category = category
  }
  if (dueDate !== undefined) patch.due_date = dueDate || null
  if (typeof notes === 'string') patch.notes = notes

  const { data, error } = await supabase
    .from('seo_tasks')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Task not found or not yours' }, { status: 404 })

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase } = guard

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('seo_tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
