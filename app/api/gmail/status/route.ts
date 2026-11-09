import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getServiceAccount, isWorkspaceEmail, workspaceConfigError, workspaceDomains } from '@/lib/google/workspace'

// Admin-only: Workspace Gmail configuration + per-mailbox sync status for Settings.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const configError = workspaceConfigError()
  const service = createServiceClient()
  const [{ data: profiles }, { data: states }] = await Promise.all([
    service.from('profiles').select('id, email, full_name, role'),
    service.from('gmail_sync_state')
      .select('user_id, mailbox, last_synced_at, last_imported, total_imported, last_error, last_error_at, backfill_after'),
  ])
  type Row = { id: string; email: string; full_name: string | null; role: string }
  const stateById = new Map((states || []).map(s => [s.user_id as string, s]))

  const mailboxes = ((profiles || []) as Row[])
    .filter(p => isWorkspaceEmail(p.email))
    .map(p => ({
      user_id: p.id,
      name: p.full_name,
      email: p.email,
      role: p.role,
      ...(stateById.get(p.id) || {}),
    }))
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)))

  return NextResponse.json({
    configured: !configError,
    config_error: configError,
    service_account: configError ? null : getServiceAccount()?.client_email,
    domains: workspaceDomains(),
    mailboxes,
  })
}
