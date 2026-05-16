import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PREVIEW_COOKIE } from '@/lib/portal-context'

export async function updateSession(request: NextRequest) {
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

  const pathname     = request.nextUrl.pathname
  const isAuthPage   = pathname.startsWith('/login') || pathname.startsWith('/auth/')
  const isPortal     = pathname.startsWith('/portal')
  const isSignRoute  = pathname.startsWith('/sign')
  const isPublicApi  = pathname.startsWith('/api/public')
  const isCronApi    = pathname.startsWith('/api/cron')

  if (!user && !isAuthPage && !isSignRoute && !isPublicApi && !isCronApi) {
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
    const hasPreviewCookie = !!request.cookies.get(PREVIEW_COOKIE)?.value

    // Client users must stay inside /portal
    if (role === 'client' && !isPortal && !isAuthPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/portal'
      return NextResponse.redirect(url)
    }

    // Staff users can access /portal ONLY when admin preview cookie is present
    if (role !== 'client' && isPortal && !hasPreviewCookie) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }

    // Already logged-in hitting an auth page — redirect away EXCEPT for /auth/set-password.
    // New invited users arrive at set-password with a session already established;
    // we must let them stay to set their password.
    if (isAuthPage && pathname !== '/auth/set-password') {
      const url = request.nextUrl.clone()
      url.pathname = role === 'client' ? '/portal' : '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
