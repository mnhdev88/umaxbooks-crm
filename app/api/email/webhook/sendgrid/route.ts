import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// SendGrid Event Webhook handler
// Register this URL in SendGrid → Settings → Mail Settings → Event Webhook
// Enable events: Delivered, Bounce, Spam Report
//
// Optionally set SENDGRID_WEBHOOK_SECRET in env and enable Signed Event Webhooks
// in SendGrid for production security.

interface SendGridEvent {
  event: 'delivered' | 'bounce' | 'spamreport' | 'open' | 'click' | 'dropped' | 'deferred' | string
  sg_message_id: string  // format: "{message_id}.filter0"
  email: string
  timestamp: number
  reason?: string        // present on bounce
  type?: string          // bounce type: 'bounce' | 'blocked'
}

function extractMessageId(sgMessageId: string): string {
  // SendGrid appends ".filterN" to the message ID in webhook events
  return sgMessageId.split('.')[0]
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

    if (event.event === 'delivered') {
      await service
        .from('email_sends')
        .update({ status: 'delivered', delivered_at: new Date(event.timestamp * 1000).toISOString() })
        .eq('sendgrid_message_id', messageId)
        .eq('status', 'sent') // only update if still 'sent', don't overwrite bounced

    } else if (event.event === 'bounce' || event.event === 'dropped') {
      await service
        .from('email_sends')
        .update({
          status: 'bounced',
          bounced_at: new Date(event.timestamp * 1000).toISOString(),
          error: event.reason || event.type || 'Bounced',
        })
        .eq('sendgrid_message_id', messageId)

    } else if (event.event === 'spamreport') {
      await service
        .from('email_sends')
        .update({ status: 'spam' })
        .eq('sendgrid_message_id', messageId)
    }
  }

  return NextResponse.json({ ok: true })
}
