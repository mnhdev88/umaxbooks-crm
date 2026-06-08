import { NextRequest, NextResponse } from 'next/server'
import { startOutboundCall } from '@/lib/voice/bland'

/**
 * POST /api/voice/call  — PROTOTYPE trigger for an outbound AI voice call (Bland).
 *
 * Protected by a bearer token (VOICE_TRIGGER_SECRET) so it can be curl'd for a demo
 * without a login session. Whitelisted in proxy.ts under /api/voice.
 *
 * Body: { phone: string, name?: string, company?: string, leadId?: string }
 *
 * Example:
 *   curl -X POST https://crm.noveliotech.com/api/voice/call \
 *     -H "Authorization: Bearer $VOICE_TRIGGER_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"phone":"+15551234567","name":"Jordan","company":"Acme"}'
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.VOICE_TRIGGER_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    phone?: string
    name?: string
    company?: string
    city?: string
    businessType?: string
    website?: string
    demoReady?: boolean
    leadId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.phone) {
    return NextResponse.json({ error: 'Missing "phone" in body' }, { status: 400 })
  }

  const result = await startOutboundCall({
    phone: body.phone,
    name: body.name,
    company: body.company,
    city: body.city,
    businessType: body.businessType,
    website: body.website,
    demoReady: body.demoReady,
    leadId: body.leadId,
  })

  if (!result.ok) {
    console.error('[voice/call] Bland call failed:', result.error, result.body)
    return NextResponse.json(
      { ok: false, error: result.error, details: result.body },
      { status: result.status }
    )
  }

  return NextResponse.json({ ok: true, callId: result.callId })
}
