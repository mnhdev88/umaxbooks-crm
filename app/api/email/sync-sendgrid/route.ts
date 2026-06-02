import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Maps SendGrid Messages API status values to our internal status values
function mapSgStatus(sgStatus: string): { status: string; bounceType?: string } | null {
  switch (sgStatus) {
    case 'delivered':    return { status: 'delivered' }
    case 'bounced':      return { status: 'bounced', bounceType: 'hard' }
    case 'blocked':      return { status: 'bounced', bounceType: 'soft' }
    case 'dropped':      return { status: 'bounced', bounceType: 'hard' }
    case 'expired':      return { status: 'bounced', bounceType: 'hard' }
    case 'spam':         return { status: 'spam' }
    case 'unsubscribed': return { status: 'unsubscribed' }
    case 'deferred':     return { status: 'deferred' }
    // 'processed' = accepted by SendGrid but not yet delivered — leave as 'sent'
    default:             return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  // Find all SendGrid emails still stuck on 'sent' that have a message ID to look up
  const { data: staleSends, error: fetchError } = await service
    .from('email_sends')
    .select('id, sendgrid_message_id, provider_id')
    .eq('status', 'sent')
    .not('sendgrid_message_id', 'is', null)
    .limit(100)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!staleSends || staleSends.length === 0) {
    return NextResponse.json({ synced: 0, message: 'No pending emails to sync' })
  }

  // Get the SendGrid API key from the first provider_id found (they all share the same key)
  const providerIds = [...new Set(staleSends.map((s: any) => s.provider_id).filter(Boolean))]
  const { data: provider } = await service
    .from('email_providers')
    .select('password')
    .eq('id', providerIds[0])
    .eq('provider', 'sendgrid')
    .single()

  if (!provider?.password) {
    return NextResponse.json({ error: 'SendGrid API key not found. Make sure a SendGrid provider is configured.' }, { status: 400 })
  }

  const apiKey = provider.password
  let synced = 0
  let failed = 0

  for (const send of staleSends as any[]) {
    try {
      // Query SendGrid Messages Activity Feed API for this specific message
      const sgRes = await fetch(
        `https://api.sendgrid.com/v3/messages?limit=1&query=msg_id%3D%22${encodeURIComponent(send.sendgrid_message_id)}%22`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      )

      if (!sgRes.ok) {
        // 403 = Messages API add-on not enabled on this SendGrid plan
        if (sgRes.status === 403) {
          return NextResponse.json({
            error: 'SendGrid Messages API is not available on your current plan. Enable the "Email Activity History" add-on in SendGrid to use this feature.',
            addOnRequired: true,
          }, { status: 402 })
        }
        failed++
        continue
      }

      const data = await sgRes.json()
      const msg  = data?.messages?.[0]
      if (!msg) continue

      const mapped = mapSgStatus(msg.status)
      if (!mapped) continue  // still processing — nothing to update

      const update: Record<string, any> = {
        status: mapped.status,
      }
      if (mapped.bounceType) update.bounce_type = mapped.bounceType
      if (mapped.status === 'delivered')    update.delivered_at    = msg.last_event_time || new Date().toISOString()
      if (mapped.status === 'bounced')      update.bounced_at      = msg.last_event_time || new Date().toISOString()
      if (mapped.status === 'unsubscribed') update.unsubscribed_at = msg.last_event_time || new Date().toISOString()
      if (mapped.status === 'deferred')     update.deferred_at     = msg.last_event_time || new Date().toISOString()

      // Also sync open/click counts from the Messages API response
      if ((msg.opens_count || 0) > 0 && send.tracking_token === null) {
        update.click_count = msg.clicks_count || 0
      }

      await service.from('email_sends').update(update).eq('id', send.id)
      synced++
    } catch {
      failed++
    }
  }

  return NextResponse.json({
    synced,
    failed,
    total: staleSends.length,
    message: `Updated ${synced} of ${staleSends.length} emails.`,
  })
}
