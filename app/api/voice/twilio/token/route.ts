import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mintVoiceToken, clientIdentityForUser } from '@/lib/voice/twilio'

/**
 * GET /api/voice/twilio/token — mint a short-lived Twilio Voice access token for the
 * browser softphone. Requires a logged-in staff session; the token's identity is keyed
 * to the user id so we can attribute calls to the agent who placed them.
 *
 * The browser fetches this on load and refreshes it before the ~1h TTL expires.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const token = mintVoiceToken(user.id)
    return NextResponse.json({ token, identity: clientIdentityForUser(user.id) })
  } catch (e) {
    console.error('[voice/twilio/token] failed to mint token', e)
    return NextResponse.json(
      { error: 'Twilio not configured', detail: (e as Error).message },
      { status: 500 }
    )
  }
}
