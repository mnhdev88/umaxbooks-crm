import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ZeroBounce status → the same verdict vocabulary the frontend already renders.
// "valid" -> Valid, "invalid"/"spamtrap"/"abuse"/"do_not_mail" -> Invalid, everything else (catch-all/unknown) -> Risky.
function verdictFromStatus(status: string): 'Valid' | 'Risky' | 'Invalid' {
  if (status === 'valid') return 'Valid'
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) return 'Invalid'
  return 'Risky'
}

function scoreFromStatus(status: string): number {
  if (status === 'valid') return 1
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) return 0
  return 0.5
}

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email } = await req.json()
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const apiKey = process.env.ZEROBOUNCE_API_KEY || ''
  if (!apiKey) {
    return NextResponse.json({ error: 'No ZeroBounce API key configured.' }, { status: 400 })
  }

  const url = new URL('https://api.zerobounce.net/v2/validate')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('email', email.trim())
  url.searchParams.set('ip_address', '')

  const res = await fetch(url.toString())

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as any)?.error || res.statusText || 'Validation failed'
    console.error('[email/validate] ZeroBounce error', res.status, msg)

    if (res.status === 401) {
      return NextResponse.json({
        error: `ZeroBounce auth error (${res.status}): ${msg}. Check ZEROBOUNCE_API_KEY.`,
      }, { status: 402 })
    }
    return NextResponse.json({ error: `${res.status}: ${msg}` }, { status: 500 })
  }

  const data = await res.json()
  if (data?.error) {
    const msg = String(data.error)
    const isAuthError = /key/i.test(msg) && /invalid|inactive/i.test(msg)
    return NextResponse.json(
      { error: isAuthError ? `ZeroBounce auth error: ${msg}. Check ZEROBOUNCE_API_KEY.` : msg },
      { status: isAuthError ? 402 : 500 }
    )
  }

  const status = data?.status as string // valid | invalid | catch-all | unknown | spamtrap | abuse | do_not_mail
  const subStatus = data?.sub_status as string // e.g. disposable | role_based | mailbox_not_found | ...
  const verdict = verdictFromStatus(status)

  return NextResponse.json({
    verdict,
    score: scoreFromStatus(status),
    suggestion: data?.did_you_mean || null,
    checks: {
      hasValidSyntax:      status !== 'invalid' || subStatus !== 'failed_syntax_check',
      hasMxRecord:         !!data?.mx_found,
      isDisposable:        subStatus === 'disposable',
      isRoleAddress:       subStatus === 'role_based',
      hasKnownBounces:     status === 'invalid',
      hasSuspectedBounces: status === 'unknown',
    },
  })
}
