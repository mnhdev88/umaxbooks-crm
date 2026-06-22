import { createBrowserClient } from '@supabase/ssr'

// Singleton: one browser client (and therefore one Realtime WebSocket) per tab.
// Components call createClient() in their render body, so returning a fresh
// client each time would spin up a new socket every render and make effects that
// depend on `supabase` re-subscribe their channels constantly — dropping
// realtime events (new chats not arriving until reload). Reuse one instance.
function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

let browserClient: ReturnType<typeof makeClient> | undefined

export function createClient() {
  if (!browserClient) browserClient = makeClient()
  return browserClient
}
