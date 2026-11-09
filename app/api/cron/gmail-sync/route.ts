import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncAllMailboxes } from '@/lib/gmail-sync'

// Gmail → CRM sync for every Workspace agent mailbox (see lib/gmail-sync.ts).
// GET:  Vercel cron, every 5 minutes (Authorization: Bearer $CRON_SECRET)
// POST: "Sync now" — admins sync every mailbox (Settings), others their own (Emails inbox)
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await syncAllMailboxes(createServiceClient())
  return NextResponse.json(summarize(result), { status: result.ok ? 200 : 500 })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || ['client', 'developer'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Admins sync every mailbox; everyone else syncs only their own (Emails inbox button)
  const result = await syncAllMailboxes(
    createServiceClient(),
    profile.role === 'admin' ? {} : { userIds: [user.id] },
  )
  return NextResponse.json(summarize(result), { status: result.ok ? 200 : 400 })
}

function summarize(result: Awaited<ReturnType<typeof syncAllMailboxes>>) {
  return {
    ok: result.ok,
    error: result.error,
    mailboxes: result.mailboxes.length,
    imported: result.mailboxes.reduce((n, m) => n + m.imported, 0),
    failed: result.mailboxes.filter(m => m.error).map(m => ({ mailbox: m.mailbox, error: m.error })),
  }
}
