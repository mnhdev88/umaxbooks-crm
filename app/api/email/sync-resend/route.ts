import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// crypto/fetch fine on edge, but Resend keys + service role → keep on Node runtime
export const runtime = 'nodejs'

// Maps Resend's `last_event` (the status shown in the Resend dashboard logs) to our
// internal delivery status. Delivery-only: opened/clicked count as "delivered" here —
// the CRM keeps its own pixel/redirect tracking for the Opened/Clicked badges, so we
// don't pull Resend's open/click data (avoids double-counting).
function mapResendStatus(lastEvent: string): { status: string; error?: string } | null {
  switch (lastEvent) {
    case 'delivered':        return { status: 'delivered' }
    case 'opened':           return { status: 'delivered' }  // opened ⇒ was delivered
    case 'clicked':          return { status: 'delivered' }  // clicked ⇒ was delivered
    case 'bounced':          return { status: 'bounced' }
    case 'complained':       return { status: 'spam' }
    case 'delivery_delayed': return { status: 'deferred', error: 'Delivery delayed' }
    case 'canceled':         return { status: 'failed', error: 'Canceled' }
    case 'failed':           return { status: 'failed', error: 'Failed' }
    // 'queued' | 'scheduled' | 'sent' = accepted but not yet resolved — leave as 'sent'
    default:                 return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  // Emails still in flight ('sent'/'deferred') that carry a Resend message id to look up
  const { data: staleSends, error: fetchError } = await service
    .from('email_sends')
    .select('id, resend_message_id, provider_id, status, delivered_at, bounced_at, deferred_at, sent_at, created_at')
    .in('status', ['sent', 'deferred'])
    .not('resend_message_id', 'is', null)
    .limit(100)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!staleSends || staleSends.length === 0) {
    return NextResponse.json({ synced: 0, message: 'No pending emails to sync' })
  }

  // Resolve the Resend API key(s). Different sends could in theory use different Resend
  // provider rows, so cache the key per provider_id (key lives in the `api_key` column).
  const providerIds = [...new Set(staleSends.map((s: any) => s.provider_id).filter(Boolean))]
  const keyByProvider = new Map<string, string>()
  if (providerIds.length > 0) {
    const { data: providers } = await service
      .from('email_providers')
      .select('id, api_key')
      .in('id', providerIds)
      .eq('provider', 'resend')
    for (const p of providers || []) {
      if (p.api_key) keyByProvider.set(p.id, p.api_key)
    }
  }

  if (keyByProvider.size === 0) {
    return NextResponse.json(
      { error: 'Resend API key not found. Make sure a Resend provider is configured.' },
      { status: 400 }
    )
  }

  let synced = 0
  let failed = 0
  let authError = false
  let authMessage = 'Resend rejected the API key (401/403). Check the key on your Resend provider in Settings → Email Providers.'

  for (const send of staleSends as any[]) {
    const apiKey = send.provider_id ? keyByProvider.get(send.provider_id) : undefined
    if (!apiKey) { failed++; continue }

    try {
      // Retrieve the email — the response includes `last_event`, the exact status
      // shown in the Resend dashboard logs. https://resend.com/docs/api-reference/emails/retrieve-email
      const res = await fetch(
        `https://api.resend.com/emails/${encodeURIComponent(send.resend_message_id)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      )

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          authError = true
          // Resend returns name:'restricted_api_key' when the key can only send email.
          // Reading statuses needs a Full access key, so tell the admin exactly that.
          const body = await res.json().catch(() => null)
          if (body?.name === 'restricted_api_key') {
            authMessage = 'Your Resend API key is "Sending access" only, so it can\'t read delivery status. Create a Full access key in Resend → API Keys and update it in Settings → Email Providers. (Or set up the Resend webhook for automatic updates — that needs no key change.)'
          }
          break
        }
        failed++
        continue
      }

      const data = await res.json()
      const lastEvent: string | undefined = data?.last_event
      if (!lastEvent) continue

      const mapped = mapResendStatus(lastEvent)
      if (!mapped) continue  // still in flight — nothing to update

      // Approximate the event time with the send's own timestamp (the retrieve endpoint
      // doesn't return per-event times). Only stamp columns that aren't already set.
      const stamp = send.sent_at || send.created_at || new Date().toISOString()
      const update: Record<string, any> = { status: mapped.status }
      if (mapped.error) update.error = mapped.error
      if (mapped.status === 'delivered' && !send.delivered_at) update.delivered_at = stamp
      if (mapped.status === 'bounced'   && !send.bounced_at)   update.bounced_at   = stamp
      if (mapped.status === 'deferred'  && !send.deferred_at)  update.deferred_at  = stamp

      const { error: upErr } = await service.from('email_sends').update(update).eq('id', send.id)
      if (upErr) { failed++; continue }
      synced++
    } catch {
      failed++
    }
  }

  if (authError) {
    return NextResponse.json({ error: authMessage }, { status: 400 })
  }

  return NextResponse.json({
    synced,
    failed,
    total: staleSends.length,
    message: `Updated ${synced} of ${staleSends.length} emails.`,
  })
}
