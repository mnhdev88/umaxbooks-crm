import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PREVIEW_COOKIE } from '@/lib/portal-context'

// req.url on Vercel uses the internal binding address (0.0.0.0:3000).
// Use NEXT_PUBLIC_APP_URL, or fall back to the public host header.
function origin(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', origin(req)))

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['admin', 'agent', 'sales_agent', 'developer'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  const res = NextResponse.redirect(new URL('/portal', origin(req)))
  // Cookie lasts 1 hour — enough for a testing session
  res.cookies.set(PREVIEW_COOKIE, leadId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60,
    path: '/',
  })
  return res
}

// Clear the preview cookie when staff exits the portal
export async function DELETE(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', origin(req)))
  res.cookies.delete(PREVIEW_COOKIE)
  return res
}
