import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  CONTRACT_PACKAGES, MIN_MONTHS, MAX_MONTHS,
  FALLBACK_PACKAGE_DEFAULTS, readPackageDefaults, type PackageDefaults,
} from '@/lib/contract-plan'

// Suggested contract totals / down-payment % / month counts per package
// (app_settings.contract_package_defaults), used to pre-fill the contract modal.
//
// GET is open to any signed-in user because sales agents send contracts and the
// modal needs the suggestions. Writes are admin-only, and go through the service
// client since app_settings has no client write policy.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data } = await service
    .from('app_settings').select('value').eq('key', 'contract_package_defaults').maybeSingle()

  return NextResponse.json({
    packages: CONTRACT_PACKAGES,
    defaults: data?.value ? readPackageDefaults(data.value) : { ...FALLBACK_PACKAGE_DEFAULTS },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const incoming = body?.defaults

  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return NextResponse.json({ error: 'Expected a defaults object.' }, { status: 400 })
  }

  // Validate strictly here rather than silently clamping, so an admin who fat-fingers
  // a value is told about it instead of quietly getting a different number.
  const defaults: PackageDefaults = {}
  for (const pkg of CONTRACT_PACKAGES) {
    const row      = incoming[pkg] || {}
    const total    = Number(row.total)
    const down_pct = Number(row.down_pct)
    const months   = Number(row.months)

    if (!Number.isFinite(total) || total < 0 || total > 1_000_000) {
      return NextResponse.json({ error: `${pkg}: total must be between 0 and 1,000,000.` }, { status: 400 })
    }
    if (!Number.isFinite(down_pct) || down_pct < 0 || down_pct > 100) {
      return NextResponse.json({ error: `${pkg}: down payment % must be between 0 and 100.` }, { status: 400 })
    }
    if (!Number.isInteger(months) || months < MIN_MONTHS || months > MAX_MONTHS) {
      return NextResponse.json({ error: `${pkg}: months must be a whole number between ${MIN_MONTHS} and ${MAX_MONTHS}.` }, { status: 400 })
    }
    defaults[pkg] = { total: Math.round(total * 100) / 100, down_pct, months }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('app_settings')
    // app_settings.value is TEXT, so the object is stored as a JSON string.
    .upsert({ key: 'contract_package_defaults', value: JSON.stringify(defaults) }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ defaults })
}
