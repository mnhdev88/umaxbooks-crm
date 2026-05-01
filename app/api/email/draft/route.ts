import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lead_id = req.nextUrl.searchParams.get('lead_id')
  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  const { data } = await supabase.from('email_drafts').select('*').eq('lead_id', lead_id).maybeSingle()
  return NextResponse.json({ draft: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lead_id, ...rest } = body
  if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  const { error } = await supabase.from('email_drafts').upsert(
    { lead_id, saved_by: user.id, ...rest, updated_at: new Date().toISOString() },
    { onConflict: 'lead_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
