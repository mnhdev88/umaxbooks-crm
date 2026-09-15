import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSeoReport } from '@/lib/seo/send-report'

// Human-initiated send of a monthly report. Deliberately NOT gated on the
// automated-email kill switch — that switch exists to stop unattended sends, and
// somebody is pressing this button.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase, profile } = guard

  const { reportId, to, commentary } = await req.json().catch(() => ({} as any))
  if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 })

  // Ownership check through the user's own client: RLS returns nothing for a
  // report on somebody else's site.
  const { data: owned } = await supabase
    .from('seo_reports')
    .select('id')
    .eq('id', reportId)
    .maybeSingle()

  if (!owned) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  // Save the commentary first, so a failed send doesn't lose what they wrote.
  if (typeof commentary === 'string') {
    await supabase
      .from('seo_reports')
      .update({ commentary, updated_at: new Date().toISOString() })
      .eq('id', reportId)
  }

  // The send itself runs as service: it touches leads and activity_logs, which
  // an SEO agent has no write access to.
  const result = await sendSeoReport(createServiceClient(), reportId, {
    to,
    commentary: typeof commentary === 'string' ? commentary : undefined,
    sentBy: profile.id,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, to: result.to })
}
