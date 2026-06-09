import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { analyzeCall } from '@/lib/voice/bland'
import { sendTemplateEmailToLead } from '@/lib/email'

// Template used for the automatic post-call cold-outreach email. Override via env.
// Matches the Settings template by name (case-insensitive, with a "cold outreach" fallback).
const COLD_OUTREACH_TEMPLATE =
  process.env.COLD_OUTREACH_TEMPLATE_NAME ||
  'Email 1 Day 1 Cold outreach - "I built it, it\'s live for 10 days"'

/**
 * POST /api/voice/webhook  — receives Bland's end-of-call webhook.
 *
 * Public (no login) — whitelisted in proxy.ts. Bland POSTs the full call record here
 * when the call ends. We verify with a shared secret passed as ?secret= on the URL
 * (the call helper appends VOICE_WEBHOOK_SECRET automatically).
 *
 * What we do with it:
 *   1. Ask Bland to analyse the call (POST /v1/calls/{id}/analyze) and extract what the
 *      CALLER said — interest, appointment/callback, business qualifiers, objections,
 *      do-not-call. Bland does the analysis; we just map the answers.
 *   2. Save one structured row per call to `voice_calls`.
 *   3. Roll the latest outcome up onto the lead (do_not_call / last_call_*).
 *   4. Keep an activity_logs entry so the call shows on the lead's timeline.
 *
 * Every step is best-effort — we never fail the webhook over our own storage.
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

  // Only a human conversation carries caller data worth extracting. Let Bland
  // analyse the call and hand us back the structured answers.
  const extracted = answeredBy === 'human' && callId
    ? await analyzeCall(callId).catch((e) => {
        console.error('[voice/webhook] analyzeCall error', e)
        return null
      })
    : null

  try {
    const supabase = createServiceClient()

    // 1. Structured record — one row per call. Idempotent on call_id so Bland retries
    //    don't create duplicates.
    await supabase
      .from('voice_calls')
      .upsert({
        lead_id: leadId ?? null,
        call_id: callId || null,
        answered_by: answeredBy,
        completed,
        call_length_min: typeof callLengthMin === 'number' ? callLengthMin : null,
        recording_url: recordingUrl || null,
        transcript: transcript || null,
        summary: summary || null,
        interested: extracted?.interested ?? null,
        objection: extracted?.objection ?? null,
        do_not_call: extracted?.do_not_call ?? false,
        appointment_booked: extracted?.appointment_booked ?? false,
        appointment_time: extracted?.appointment_time ?? null,
        callback_requested: extracted?.callback_requested ?? false,
        callback_time: extracted?.callback_time ?? null,
        has_website: extracted?.has_website ?? null,
        current_website: extracted?.current_website ?? null,
        budget_mentioned: extracted?.budget_mentioned ?? null,
        decision_maker: extracted?.decision_maker ?? null,
        notes: extracted?.notes ?? null,
        extracted: extracted ?? null,
      }, { onConflict: 'call_id', ignoreDuplicates: false })

    if (leadId) {
      // 2. Roll the latest outcome up onto the lead so the card/list reflects it.
      const outcome = answeredBy === 'human' ? (extracted?.interested ?? 'completed') : answeredBy
      const leadUpdate: Record<string, unknown> = {
        last_call_outcome: outcome,
        last_call_at: new Date().toISOString(),
      }
      if (extracted?.do_not_call) leadUpdate.do_not_call = true
      await supabase.from('leads').update(leadUpdate).eq('id', leadId)

      // 3. Timeline entry so the call shows on the lead's Activity tab.
      const details = [
        summary || transcript.slice(0, 500) || '(no transcript)',
        answeredBy ? `Answered by: ${answeredBy}.` : null,
        extracted?.interested ? `Interest: ${extracted.interested}.` : null,
        extracted?.appointment_booked
          ? `Appointment booked${extracted.appointment_time ? ` (${extracted.appointment_time})` : ''}.`
          : null,
        extracted?.callback_requested
          ? `Callback requested${extracted.callback_time ? ` (${extracted.callback_time})` : ''}.`
          : null,
        extracted?.objection ? `Objection: ${extracted.objection}.` : null,
        extracted?.do_not_call ? 'DO NOT CALL — caller asked not to be contacted.' : null,
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

      // 4. Auto cold-outreach email — fires when a call ends by ANY means, once per lead.
      //    Skipped for: no email, do-not-call, unsubscribed, or already-sent. Kill switch:
      //    set COLD_OUTREACH_AFTER_CALL=off to disable entirely. Best-effort.
      if (process.env.COLD_OUTREACH_AFTER_CALL !== 'off') {
        try {
          const { data: lead } = await supabase
            .from('leads')
            .select('id, name, company_name, email, city, business_type, gmb_category, do_not_call, email_unsubscribed, cold_outreach_sent_at')
            .eq('id', leadId)
            .single()

          const blocked =
            !lead?.email ||
            lead.cold_outreach_sent_at ||
            lead.email_unsubscribed ||
            lead.do_not_call ||
            extracted?.do_not_call

          if (lead && !blocked) {
            const { sent, error } = await sendTemplateEmailToLead({
              lead: {
                id: lead.id, name: lead.name, company_name: lead.company_name, email: lead.email,
                city: lead.city, business_type: lead.business_type, gmb_category: lead.gmb_category,
              },
              templateName: COLD_OUTREACH_TEMPLATE,
              context: 'auto-sent after AI voice call',
            })
            if (sent) {
              await supabase.from('leads').update({ cold_outreach_sent_at: new Date().toISOString() }).eq('id', leadId)
            } else {
              console.warn('[voice/webhook] cold-outreach email not sent for lead', leadId, error)
            }
          }
        } catch (e) {
          console.error('[voice/webhook] cold-outreach email step failed', leadId, e)
        }
      }
    }
  } catch (e) {
    // Best-effort — never fail the webhook over storage.
    console.error('[voice/webhook] Failed to persist call', callId, e)
  }

  return NextResponse.json({ ok: true })
}
