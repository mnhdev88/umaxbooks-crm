import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// 1x1 transparent GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

const HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  try {
    const supabase = createServiceClient()
    const now = new Date().toISOString()

    const { data: record } = await supabase
      .from('email_tracking')
      .select('id, first_opened_at, opened_count')
      .eq('token', token)
      .maybeSingle()

    if (record) {
      await supabase
        .from('email_tracking')
        .update({
          first_opened_at: record.first_opened_at ?? now,
          last_opened_at: now,
          opened_count: (record.opened_count ?? 0) + 1,
        })
        .eq('id', record.id)
    }
  } catch {
    // Never block the pixel response due to a DB error
  }

  return new NextResponse(GIF, { headers: HEADERS })
}
