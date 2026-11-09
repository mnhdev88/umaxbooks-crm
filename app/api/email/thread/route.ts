import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canViewEmailThread } from '@/lib/email-conversations'

// GET ?lead_id= — every email in a lead's conversation (oldest first), with bodies.
// POST { lead_id } — mark the conversation read for the current user.

async function authorize(leadId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!leadId) return { error: NextResponse.json({ error: 'lead_id required' }, { status: 400 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const ok = profile && await canViewEmailThread(supabase, { userId: user.id, role: profile.role, leadId })
  if (!ok) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { supabase, user }
}

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead_id')
  const auth = await authorize(leadId)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const { data, error } = await supabase
    .from('email_sends')
    .select(
      'id, direction, source, status, from_email, to_email, cc, subject, html_body, attachments, ' +
      'sent_at, created_at, error, tracking_token, sender:sent_by(full_name), mailbox:mailbox_user_id(full_name, email)'
    )
    .eq('lead_id', leadId!)
    .neq('status', 'scheduled')
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const emails = ((data || []) as unknown as { sent_at: string | null; created_at: string; tracking_token: string | null }[])
    .sort((a, b) => Date.parse(a.sent_at || a.created_at) - Date.parse(b.sent_at || b.created_at))

  // Open tracking for CRM sends
  const tokens = emails.map(e => e.tracking_token).filter((t): t is string => !!t)
  let opens: Record<string, { first_opened_at: string | null; opened_count: number }> = {}
  if (tokens.length) {
    const { data: rows } = await supabase
      .from('email_tracking')
      .select('token, first_opened_at, opened_count')
      .in('token', tokens)
    opens = Object.fromEntries((rows || []).map((r: { token: string; first_opened_at: string | null; opened_count: number }) =>
      [r.token, { first_opened_at: r.first_opened_at, opened_count: r.opened_count }]))
  }

  return NextResponse.json({ emails, opens })
}

export async function POST(req: NextRequest) {
  const { lead_id } = await req.json().catch(() => ({}))
  const auth = await authorize(lead_id ?? null)
  if ('error' in auth) return auth.error
  const { supabase, user } = auth

  const { error } = await supabase
    .from('email_thread_reads')
    .upsert({ user_id: user.id, lead_id, read_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
