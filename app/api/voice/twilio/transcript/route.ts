import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchTranscript } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/transcript — Conversational Intelligence webhook.
 *
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts. The Intelligence
 * Service is configured (via API) to POST here when a transcript reaches a terminal state.
 * We fetch the finished transcript, flatten it to text, and write it onto the voice_calls
 * row identified by the transcript's customerKey (the CallSid we set at creation time).
 *
 * Verified with the shared ?secret= on the URL, same as the other voice webhooks.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TWILIO_WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CI posts form-encoded events; tolerate JSON too.
  let params: Record<string, string> = {}
  try {
    const form = await req.formData()
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''
  } catch {
    try {
      params = (await req.json()) as Record<string, string>
    } catch {
      return NextResponse.json({ error: 'Bad body' }, { status: 400 })
    }
  }

  const transcriptSid = params.transcript_sid || params.TranscriptSid || params.sid || ''
  const eventType = params.event_type || params.EventType || ''
  // Only act once the transcript is actually available.
  if (!transcriptSid || (eventType && !/available|completed/i.test(eventType))) {
    return NextResponse.json({ ok: true, skipped: eventType || 'no-sid' })
  }

  try {
    const { text, customerKey } = await fetchTranscript(transcriptSid)
    if (customerKey && text) {
      const supabase = createServiceClient()
      await supabase
        .from('voice_calls')
        .upsert(
          { call_id: customerKey, provider: 'twilio', transcript: text },
          { onConflict: 'call_id', ignoreDuplicates: false }
        )
      console.log('[voice/twilio/transcript] saved transcript', { transcriptSid, callSid: customerKey, chars: text.length })
    } else {
      console.warn('[voice/twilio/transcript] no customerKey/text', { transcriptSid })
    }
  } catch (e) {
    console.error('[voice/twilio/transcript] failed', transcriptSid, e)
  }

  return NextResponse.json({ ok: true })
}
