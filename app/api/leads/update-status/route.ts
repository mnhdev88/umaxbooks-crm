import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead_id, status } = await req.json()
  if (!lead_id || !status) return NextResponse.json({ error: 'Missing lead_id or status' }, { status: 400 })

  const service = createServiceClient()
  const { error } = await service
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', lead_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
