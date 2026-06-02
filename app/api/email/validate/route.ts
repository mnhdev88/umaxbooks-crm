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
    if (res.status === 403) {
      return NextResponse.json({
        error: 'Email Validation is not enabled on your SendGrid plan. Enable it under SendGrid → Settings → Email Validation.',
      }, { status: 402 })
    }
    const err = await res.json().catch(() => ({}))
    return NextResponse.json({ error: (err as any)?.errors?.[0]?.message || 'Validation failed' }, { status: 500 })
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
