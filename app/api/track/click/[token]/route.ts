import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const destination = req.nextUrl.searchParams.get('url') || '/'

  // Validate destination is a real URL before redirecting
  let safeUrl: string
  try {
    const parsed = new URL(destination)
    // Only allow http/https destinations — block javascript: and data: URIs
    safeUrl = parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? destination
      : '/'
  } catch {
    safeUrl = '/'
  }

  try {
    const supabase = createServiceClient()
    const now = new Date().toISOString()

    const { data: send } = await supabase
      .from('email_sends')
      .select('id, click_count, first_clicked_at')
      .eq('tracking_token', token)
      .maybeSingle()

    if (send) {
      await supabase
        .from('email_sends')
        .update({
          click_count:      (send.click_count || 0) + 1,
          first_clicked_at: send.first_clicked_at || now,
          last_clicked_url: safeUrl,
        })
        .eq('id', send.id)
    }
  } catch {
    // Never block the redirect due to a DB error
  }

  return NextResponse.redirect(safeUrl, { status: 302 })
}
