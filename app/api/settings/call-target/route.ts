import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCallSettingsAccess } from '@/lib/settings-access'

// Read/write of the daily call target (app_settings.daily_call_target), open to admins
// and sales managers — see lib/settings-access.ts. app_settings holds secrets and has no client
// write policy, so writes go through the service client behind that role check.

export async function GET() {
  const { error } = await requireCallSettingsAccess()
  if (error) return error

  const service = createServiceClient()
  const { data } = await service.from('app_settings').select('value').eq('key', 'daily_call_target').single()
  return NextResponse.json({ target: Number(data?.value) || 50 })
}

export async function POST(req: NextRequest) {
  const { error } = await requireCallSettingsAccess()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const target = Math.trunc(Number(body?.target))
  if (!Number.isFinite(target) || target < 1 || target > 1000) {
    return NextResponse.json({ error: 'Target must be a whole number between 1 and 1000.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('app_settings')
    .upsert({ key: 'daily_call_target', value: String(target) }, { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ target })
}
