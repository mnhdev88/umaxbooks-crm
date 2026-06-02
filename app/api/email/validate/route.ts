import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email } = await req.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  // Get SendGrid API key — prefer dedicated validation key, fall back to send key
  let apiKey = process.env.SENDGRID_VALIDATION_KEY || ''

  if (!apiKey) {
    const service = createServiceClient()
    const { data: provider } = await service
      .from('email_providers')
      .select('password')
      .eq('provider', 'sendgrid')
      .eq('is_active', true)
      .single()

    apiKey = provider?.password || ''
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'No SendGrid API key configured.' }, { status: 400 })
  }

  const res = await fetch('https://api.sendgrid.com/v3/validations/email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: email.trim(), source: 'crm' }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as any)?.errors?.[0]?.message || res.statusText || 'Validation failed'
    console.error('[email/validate] SendGrid error', res.status, msg, 'key prefix:', apiKey.slice(0, 12))

    if (res.status === 403 || res.status === 401) {
      return NextResponse.json({
        error: `SendGrid auth error (${res.status}): ${msg}. Check the API key has Email Address Validation permission.`,
      }, { status: 402 })
    }
    return NextResponse.json({ error: `${res.status}: ${msg}` }, { status: 500 })
  }

  const data = await res.json()
  const result = data?.result

  return NextResponse.json({
    verdict:    result?.verdict,          // "Valid" | "Risky" | "Invalid"
    score:      result?.score,            // 0–1 confidence
    suggestion: result?.suggestion,       // e.g. "did you mean @gmail.com?"
    checks: {
      hasValidSyntax:       result?.checks?.domain?.has_valid_address_syntax,
      hasMxRecord:          result?.checks?.domain?.has_mx_or_a_record,
      isDisposable:         result?.checks?.domain?.is_suspected_disposable_address,
      isRoleAddress:        result?.checks?.local_part?.is_suspected_role_address,
      hasKnownBounces:      result?.checks?.additional?.has_known_bounces,
      hasSuspectedBounces:  result?.checks?.additional?.has_suspected_bounces,
    },
  })
}
