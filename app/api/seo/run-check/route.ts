import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'
import { runSeoCheck } from '@/lib/seo/check'

// "Run check now" from the site page. The crawl plus PageSpeed can take 30s+,
// so give the platform room rather than letting it die mid-audit.
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase, profile } = guard

  const { siteId } = await req.json().catch(() => ({} as any))
  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 })

  // RLS decides whether this user may see the site at all.
  const { data: site } = await supabase
    .from('live_sites')
    .select('id, lead_id, final_url')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const result = await runSeoCheck(supabase, site as any, { source: 'manual', ranBy: profile.id })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
