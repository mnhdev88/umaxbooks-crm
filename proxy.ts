import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Public routes — no auth required
  const isAuthPage    = path.startsWith('/login') || path.startsWith('/auth/')
  const isPortal      = path.startsWith('/portal')
  const isPublicApi   = path.startsWith('/api/public')
  const isSigningPage = path.startsWith('/sign/')
  // /api/contracts/{token} and /api/contracts/{token}/sign — but NOT the bare /api/contracts (admin list/create)
  const isSigningApi  = /^\/api\/contracts\/[^/]/.test(path)

  if (!user && !isAuthPage && !isPublicApi && !isSigningPage && !isSigningApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role
    const PREVIEW_COOKIE = 'portal_preview_lead_id'
    const hasPreviewCookie = !!request.cookies.get(PREVIEW_COOKIE)?.value

    // Client users must stay inside /portal (allow API routes so portal can make API calls)
    if (role === 'client' && !isPortal && !isAuthPage && !path.startsWith('/api/')) {
      const url = request.nextUrl.clone()
      url.pathname = '/portal'
      return NextResponse.redirect(url)
    }

    // Staff users can access /portal only with admin preview cookie
    if (role !== 'client' && isPortal && !hasPreviewCookie) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }

    // Logged-in user hitting an auth page — redirect away
    // Allow /auth/set-password so invited users can complete signup
    if (isAuthPage && path !== '/auth/set-password') {
      const url = request.nextUrl.clone()
      url.pathname = role === 'client' ? '/portal' : '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
