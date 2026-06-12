import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push'

// Called by the notifications_push_dispatch DB trigger (migration 058) on
// every notifications INSERT. Secured the same way as /api/cron/* — the
// trigger sends Bearer CRON_SECRET (app_settings.push_dispatch_secret).

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { user_id, title, message, link, notification_id } = await req.json()
  if (!user_id || !title) {
    return NextResponse.json({ error: 'Missing user_id or title' }, { status: 400 })
  }

  const result = await sendPushToUser(user_id, {
    title,
    body: message ?? '',
    url: link || '/notifications',
    // One OS notification per CRM notification, even if the trigger retries
    tag: notification_id ? `crm-${notification_id}` : undefined,
  })

  return NextResponse.json(result)
}
