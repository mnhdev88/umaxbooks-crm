import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

// Resend Event Webhook handler.
// Register this URL in Resend → Webhooks → Add Endpoint:
//   https://<your-domain>/api/email/webhook/resend
// Enable events: email.delivered, email.bounced, email.complained,
//   email.delivery_delayed, email.clicked  (email.sent/opened optional — opens are
//   already tracked by our own pixel in email_tracking).
//
// Copy the endpoint's Signing Secret (starts with "whsec_") into RESEND_WEBHOOK_SECRET.
// When set, every request's Svix signature is verified before we touch the DB.
// When unset, verification is skipped (fine for local testing, not for production).

// crypto (Svix HMAC) needs the Node runtime, not Edge.
export const runtime = 'nodejs'

interface ResendEvent {
  type: string          // e.g. 'email.delivered', 'email.bounced'
  created_at?: string
  data?: {
    email_id?: string   // === the id returned from resend.emails.send()
    to?: string[]
    subject?: string
    // present on email.bounced
    bounce?: { type?: string; subType?: string; message?: string }
    // present on email.clicked
    click?: { link?: string; timestamp?: string; ipAddress?: string; userAgent?: string }
  }
}

/**
 * Verify a Svix-signed webhook (Resend's provider).
 * Signed content is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the raw
 * secret bytes (base64 of the part after "whsec_"), compared constant-time
 * against each space-separated `v1,<sig>` entry in the svix-signature header.
 */
function verifySvixSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Reject stale/replayed deliveries (5-minute tolerance)
  const ts = Number(svixTimestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  const expectedBuf = Buffer.from(expected)

  // Header may carry several versioned signatures: "v1,<sigA> v1,<sigB>"
  return svixSignature.split(' ').some((part) => {
    const sig = part.split(',')[1] || ''
    const sigBuf = Buffer.from(sig)
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)
  })
}

// Health check — browser GET returns 200 so you can verify the route is live
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Resend webhook endpoint is live. Awaiting POST events.' })
}

export async function POST(req: NextRequest) {
  // Read the raw body first — signature verification needs the exact bytes sent.
  const rawBody = await req.text()

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    if (!verifySvixSignature(rawBody, req.headers, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
  }

  let event: ResendEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const messageId = event.data?.email_id
  if (!event.type || !messageId) {
    return NextResponse.json({ ok: true })  // nothing to match — ack so Resend doesn't retry
  }

  const ts = event.created_at || new Date().toISOString()
  console.log(`[resend-webhook] ${event.type} msgId=${messageId}`)

  const service = createServiceClient()
  const match = (q: any) => q.eq('resend_message_id', messageId)

  switch (event.type) {
    case 'email.delivered': {
      // Allow delivery_delayed → delivered as well as sent → delivered
      const { data, error } = await match(
        service.from('email_sends')
          .update({ status: 'delivered', delivered_at: ts })
          .in('status', ['sent', 'deferred'])
      ).select('id')
      console.log(`[resend-webhook] delivered matched=${data?.length ?? 0}`, error?.message || '')
      break
    }

    case 'email.bounced': {
      // Resend bounce type: 'Permanent' = hard, 'Transient'/'Undetermined' = soft
      const bounceType = event.data?.bounce?.type === 'Permanent' ? 'hard' : 'soft'
      await match(
        service.from('email_sends').update({
          status: 'bounced',
          bounced_at: ts,
          bounce_type: bounceType,
          error: event.data?.bounce?.message || event.data?.bounce?.subType || 'Bounced',
        })
      )
      break
    }

    case 'email.complained': {
      await match(service.from('email_sends').update({ status: 'spam' }))
      break
    }

    case 'email.delivery_delayed': {
      // Temporary delay — only mark deferred if not already delivered/bounced
      await match(
        service.from('email_sends')
          .update({ status: 'deferred', deferred_at: ts, error: 'Delivery delayed' })
          .in('status', ['sent'])
      )
      break
    }

    case 'email.clicked': {
      // Increment click count atomically off the current row state
      const { data: row } = await match(
        service.from('email_sends').select('click_count, first_clicked_at')
      ).maybeSingle()
      if (row !== null) {
        await match(
          service.from('email_sends').update({
            click_count: (row.click_count || 0) + 1,
            first_clicked_at: row.first_clicked_at || ts,
            last_clicked_url: event.data?.click?.link || null,
          })
        )
      }
      break
    }

    // email.sent — already recorded at send time.
    // email.opened — opens tracked by our own pixel (email_tracking); ignore here to avoid double counting.
    default:
      break
  }

  return NextResponse.json({ ok: true })
}
