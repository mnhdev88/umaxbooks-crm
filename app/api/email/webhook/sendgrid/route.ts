import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// SendGrid Event Webhook handler
// Register this URL in SendGrid → Settings → Mail Settings → Event Webhook
// Enable events: Delivered, Bounce, Spam Report, Deferred, Clicks, Unsubscribes
//
// Optionally set SENDGRID_WEBHOOK_SECRET in env and enable Signed Event Webhooks
// in SendGrid for production security.

interface SendGridEvent {
  event: 'delivered' | 'bounce' | 'spamreport' | 'open' | 'click' | 'dropped' | 'deferred' | 'unsubscribe' | 'group_unsubscribe' | string
  sg_message_id: string  // format: "{message_id}.filter0"
  email: string
  timestamp: number
  reason?: string        // present on bounce/deferred
  type?: string          // bounce type: 'bounce' (hard) | 'blocked' (soft)
  url?: string           // present on click events
  attempt?: string       // present on deferred (retry number)
}

function extractMessageId(sgMessageId: string): string {
  // SendGrid appends ".filterN" to the message ID in webhook events
  return sgMessageId.split('.')[0]
}

// Health check — browser GET returns 200 so you can verify the route is live
export async function GET() {
  return NextResponse.json({ ok: true, message: 'SendGrid webhook endpoint is live. Awaiting POST events.' })
}

export async function POST(req: NextRequest) {
  // Optional: verify shared secret to prevent spoofed webhook calls
  const secret = process.env.SENDGRID_WEBHOOK_SECRET
  if (secret) {
    const incoming = req.headers.get('x-sendgrid-webhook-secret')
    if (incoming !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let events: SendGridEvent[]
  try {
    events = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ ok: true })
  }

  const service = createServiceClient()

  for (const event of events) {
    const messageId = extractMessageId(event.sg_message_id || '')
    if (!messageId) continue

    const ts = new Date(event.timestamp * 1000).toISOString()

    if (event.event === 'delivered') {
      // Allow deferred → delivered transition as well as sent → delivered
      await service
        .from('email_sends')
        .update({ status: 'delivered', delivered_at: ts })
        .eq('sendgrid_message_id', messageId)
        .in('status', ['sent', 'deferred'])

    } else if (event.event === 'bounce') {
      // type === 'bounce' = hard bounce (permanent), type === 'blocked' = soft bounce (temporary)
      const bounceType = event.type === 'blocked' ? 'soft' : 'hard'
      await service
        .from('email_sends')
        .update({
          status: 'bounced',
          bounced_at: ts,
          bounce_type: bounceType,
          error: event.reason || event.type || 'Bounced',
        })
        .eq('sendgrid_message_id', messageId)

    } else if (event.event === 'dropped') {
      // Dropped = SendGrid suppressed the send (address on bounce/spam list) — treat as hard bounce
      await service
        .from('email_sends')
        .update({
          status: 'bounced',
          bounced_at: ts,
          bounce_type: 'hard',
          error: event.reason || 'Dropped',
        })
        .eq('sendgrid_message_id', messageId)

    } else if (event.event === 'spamreport') {
      await service
        .from('email_sends')
        .update({ status: 'spam' })
        .eq('sendgrid_message_id', messageId)

    } else if (event.event === 'deferred') {
      // Temporary rejection — only set deferred if email hasn't already been delivered/bounced
      await service
        .from('email_sends')
        .update({ status: 'deferred', deferred_at: ts, error: event.reason || `Deferred (attempt ${event.attempt || '?'})` })
        .eq('sendgrid_message_id', messageId)
        .in('status', ['sent'])

    } else if (event.event === 'unsubscribe' || event.event === 'group_unsubscribe') {
      await service
        .from('email_sends')
        .update({ status: 'unsubscribed', unsubscribed_at: ts })
        .eq('sendgrid_message_id', messageId)

    } else if (event.event === 'click') {
      // Fetch current click state then increment atomically
      const { data: row } = await service
        .from('email_sends')
        .select('click_count, first_clicked_at')
        .eq('sendgrid_message_id', messageId)
        .maybeSingle()

      if (row !== null) {
        await service
          .from('email_sends')
          .update({
            click_count: (row.click_count || 0) + 1,
            first_clicked_at: row.first_clicked_at || ts,
            last_clicked_url: event.url || null,
          })
          .eq('sendgrid_message_id', messageId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
