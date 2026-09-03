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

  // getClaims() over getUser(): this proxy runs on EVERY request that isn't a
  // static asset — every navigation, every API call, every 5s/15s/30s poll from
  // an open tab. getUser() is a network round-trip to the auth server per hit,
  // which put us at ~19,700 /auth/v1/user calls a day, peaking at 522/min. On
  // 2026-08-21 15:04 the auth server answered 66 of them with a 504, `user` came
  // back undefined, and the redirect below logged every open tab out at once.
  //
  // This project signs JWTs with ES256, so getClaims() verifies the token
  // locally against a cached JWKS — no auth-server call at all after the first
  // fetch, and nothing to time out. Claims are cryptographically verified, so
  // `sub` is as trustworthy for authorization as getUser()'s id was.
  //
  // The tradeoff getClaims() makes: a session revoked server-side (user deleted
  // or signed out elsewhere) stays valid here until its access token expires,
  // rather than dying on the next request. The role lookup below still hits the
  // DB, so a role change or a deactivated profile still takes effect at once.
  const { data: claims } = await supabase.auth.getClaims()

  const userId = claims?.claims?.sub

  const path = request.nextUrl.pathname

  // Public routes — no auth required
  const isAuthPage    = path.startsWith('/login') || path.startsWith('/auth/')
  const isPortal      = path.startsWith('/portal')
  const isPublicApi      = path.startsWith('/api/public')
  const isSigningPage    = path.startsWith('/sign/')
  // /share/<token> — the no-login client page (proposal / agreement / SEO
  // audit). Its own last-4 gate and signed cookie decide who sees what; the
  // API side is under /api/public and already covered above.
  const isSharePage      = path.startsWith('/share/')
  const isNewsletterApi  = path.startsWith('/api/newsletter')
  // Voice: /api/voice/webhook is hit by Vapi (no session); /api/voice/call is
  // bearer-protected internally. Both are whitelisted from the auth redirect.
  const isVoiceApi       = path.startsWith('/api/voice')
  // /api/contracts/{token} and /api/contracts/{token}/sign — but NOT the bare /api/contracts (admin list/create)
  const isSigningApi  = /^\/api\/contracts\/[^/]/.test(path)
  // Hit by the Supabase notifications trigger (pg_net, no session); Bearer CRON_SECRET gated internally
  const isPushDispatch = path === '/api/push/dispatch'
  // Hit by the server crontab (no session); each route verifies Bearer CRON_SECRET itself
  const isCronApi      = path.startsWith('/api/cron')

  if (!userId && !isAuthPage && !isPublicApi && !isSigningPage && !isSharePage && !isSigningApi && !isNewsletterApi && !isVoiceApi && !isPushDispatch && !isCronApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Every branch below decides where to REDIRECT a page navigation, and each one
  // already excludes /api/*: the client-portal rule skips it explicitly, and
  // /portal and the auth pages are page routes. So for an API request the role
  // is fetched and then never read — which is most of the traffic here, since
  // the polling in Sidebar/SmsInbox/DashboardShell only ever hits /api/*. That
  // made `profiles` the single busiest table in the project at ~19,300 selects
  // a day. API routes authorize themselves against RLS, so skipping it costs
  // nothing.
  const needsRole = !path.startsWith('/api/')

  if (userId && needsRole) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()

    const role = profile?.role
    const PREVIEW_COOKIE = 'portal_preview_lead_id'
    const hasPreviewCookie = !!request.cookies.get(PREVIEW_COOKIE)?.value

    // Client users must stay inside /portal (allow API routes so portal can make API calls)
    // isSharePage is excluded too: a lead who later got a portal account
    // still opens the same /share link from an old text message, and
    // bouncing them to /portal would look like the link had died.
    if (role === 'client' && !isPortal && !isAuthPage && !isSharePage && !path.startsWith('/api/')) {
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
    // manifest.webmanifest and sw.js are excluded: browsers fetch the manifest
    // without cookies, and the service worker must register before login —
    // behind the auth redirect both 307 to /login and the PWA silently breaks.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
