import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * POST /api/voice/webhook  — receives Bland's end-of-call webhook.
 *
 * Public (no login) — whitelisted in proxy.ts. Bland POSTs the full call record here
 * when the call ends. We verify with a shared secret passed as ?secret= on the URL
 * (the call helper appends VOICE_WEBHOOK_SECRET automatically).
 *
 * If the call was tagged with a leadId (via metadata), we log the result to
 * activity_logs so it shows up on the lead. Otherwise we just acknowledge it.
 *
 * Bland webhook fields: https://docs.bland.ai/tutorials/webhooks
 */
export async function POST(req: NextRequest) {
  // Optional shared-secret verification (recommended once configured).
  const expected = process.env.VOICE_WEBHOOK_SECRET
  if (expected) {
    const provided = req.nextUrl.searchParams.get('secret')
    if (provided !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    console.warn('[voice/webhook] VOICE_WEBHOOK_SECRET not set — accepting unverified webhook (prototype only)')
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const callId: string = payload?.call_id ?? ''
  const transcript: string = payload?.concatenated_transcript ?? ''
  const summary: string = payload?.summary ?? ''
  const recordingUrl: string = payload?.recording_url ?? ''
  const callLengthMin: number | undefined = payload?.call_length
  const answeredBy: string = payload?.answered_by ?? 'unknown' // "human" | "voicemail" | ...
  const completed: boolean = payload?.completed ?? false
  const leadId: string | undefined = payload?.metadata?.leadId

  console.log('[voice/webhook] Bland call ended', {
    callId,
    leadId,
    answeredBy,
    completed,
    callLengthMin,
    hasRecording: !!recordingUrl,
    summaryPreview: summary.slice(0, 120),
  })

  // If the call was attributed to a lead, surface the result on that lead.
  if (leadId) {
    try {
      const supabase = createServiceClient()
      const details = [
        summary || transcript.slice(0, 500) || '(no transcript)',
        answeredBy ? `Answered by: ${answeredBy}.` : null,
        typeof callLengthMin === 'number' ? `Length: ${callLengthMin.toFixed(1)} min.` : null,
        recordingUrl ? `Recording: ${recordingUrl}` : null,
      ]
        .filter(Boolean)
        .join(' ')

      await supabase.from('activity_logs').insert({
        lead_id: leadId,
        user_id: null,
        action: 'AI Voice Call Completed',
        details,
      })
    } catch (e) {
      // Best-effort — never fail the webhook over logging.
      console.error('[voice/webhook] Failed to log activity for lead', leadId, e)
    }
  }

  return NextResponse.json({ ok: true })
}
