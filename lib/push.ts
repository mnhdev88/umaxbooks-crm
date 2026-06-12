import webpush from 'web-push'
import { createServiceClient } from '@/lib/supabase/service'

let configured = false

function ensureConfigured() {
  if (configured) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@noveliotech.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  configured = true
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Send a push message to every subscribed device of a user.
 * Dead subscriptions (404/410 from the push service) are pruned.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  ensureConfigured()
  const supabase = createServiceClient()

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs?.length) return { sent: 0, pruned: 0 }

  let sent = 0
  const dead: string[] = []

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
        sent++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(sub.id)
        else console.error('Push send failed:', status, sub.endpoint.slice(0, 60))
      }
    })
  )

  if (dead.length) {
    await supabase.from('push_subscriptions').delete().in('id', dead)
  }

  return { sent, pruned: dead.length }
}
