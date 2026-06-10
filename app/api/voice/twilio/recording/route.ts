import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/voice/twilio/recording?url=<twilio recording url> — authenticated proxy that
 * streams a Twilio call recording.
 *
 * Twilio recording media URLs require account auth, so the browser can't play them via a
 * bare <audio src>. This route verifies a logged-in staff session, fetches the media with
 * the account's Basic auth, and streams it back. We only allow Twilio-hosted URLs (SSRF
 * guard) and force the .mp3 media variant.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return new NextResponse('Missing url', { status: 400 })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new NextResponse('Bad url', { status: 400 })
  }
  // SSRF guard: only proxy Twilio-hosted recordings.
  if (!/(^|\.)twilio\.com$/.test(target.hostname)) {
    return new NextResponse('Forbidden host', { status: 403 })
  }
  // Twilio serves audio when the resource path ends in .mp3 (or .wav).
  if (!/\.(mp3|wav)$/i.test(target.pathname)) {
    target.pathname += '.mp3'
  }

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return new NextResponse('Twilio not configured', { status: 500 })

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const upstream = await fetch(target.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!upstream.ok || !upstream.body) {
    return new NextResponse('Recording unavailable', { status: upstream.status || 502 })
  }

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
