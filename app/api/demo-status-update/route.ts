import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('id', leadId)
    .single()

  if (lead?.status !== 'Contacted') {
    return NextResponse.json({ skipped: true })
  }

  await supabase
    .from('leads')
    .update({ status: 'Audit Ready' })
    .eq('id', leadId)

  return NextResponse.json({ success: true })
}
