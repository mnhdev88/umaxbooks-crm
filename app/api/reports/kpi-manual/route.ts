import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Manual KPI figures (proposals sent, training completion) that have no system
// event behind them. Admins can log for anyone; a non-admin only for themselves.
// One figure per (user, KPI, day) — re-posting the same day overwrites it.
//
//   GET  ?date=YYYY-MM-DD           → existing entries for that day (admin: all
//                                      users; else: self), to prefill the editor.
//   POST { user_id, kpi_key, ... }  → save one figure, OR
//   POST { entries: [ … ] }         → save many (used by the Settings grid).

const MANUAL_KEYS = new Set(['proposals_sent', 'training_completion'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = profile.role === 'admin'

  const date = req.nextUrl.searchParams.get('date') || ''
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400 })

  let q = supabase
    .from('kpi_manual_entries')
    .select('user_id, kpi_key, value')
    .eq('entry_date', date)
    .in('kpi_key', [...MANUAL_KEYS])
  if (!isAdmin) q = q.eq('user_id', user.id)

  const { data } = await q
  return NextResponse.json({ entries: data ?? [] })
}

// Validate a single entry against the caller's permissions; returns an error
// string or null.
function validateEntry(e: any, userId: string, isAdmin: boolean): string | null {
  const targetUserId = typeof e?.user_id === 'string' ? e.user_id : userId
  if (!isAdmin && targetUserId !== userId) return 'You can only log your own KPIs.'
  if (!MANUAL_KEYS.has(e?.kpi_key)) return 'Unknown or non-manual KPI.'
  if (typeof e?.entry_date !== 'string' || !DATE_RE.test(e.entry_date)) return 'entry_date must be YYYY-MM-DD.'
  const value = Number(e?.value)
  if (!Number.isFinite(value) || value < 0) return 'Value must be a non-negative number.'
  if (e.kpi_key === 'training_completion' && value > 100) return 'Training completion is a percent (0–100).'
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = profile.role === 'admin'

  const body = await req.json().catch(() => ({}))
  const incoming = Array.isArray(body?.entries) ? body.entries : [body]

  const rows: { user_id: string; kpi_key: string; entry_date: string; value: number; created_by: string; updated_at: string }[] = []
  const now = new Date().toISOString()
  for (const e of incoming) {
    const err = validateEntry(e, user.id, isAdmin)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    rows.push({
      user_id: typeof e.user_id === 'string' ? e.user_id : user.id,
      kpi_key: e.kpi_key,
      entry_date: e.entry_date,
      value: Number(e.value),
      created_by: user.id,
      updated_at: now,
    })
  }
  if (!rows.length) return NextResponse.json({ error: 'No entries to save.' }, { status: 400 })

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('kpi_manual_entries')
    .upsert(rows, { onConflict: 'user_id,kpi_key,entry_date' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ ok: true, saved: rows.length })
}
