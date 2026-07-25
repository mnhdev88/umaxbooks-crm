import { createServiceClient } from '@/lib/supabase/service'

// Global kill switch for automated (non-human-triggered) outbound email.
// See supabase/migrations/095_automated_email_toggle.sql for what it covers.
//
// Call this at the TOP of any code path that emails without a user pressing Send.
// Human-initiated sends (ComposeModal, contracts, client invites) must NOT check it.

export const AUTOMATED_EMAIL_KEY = 'automated_email_enabled'

/** Truthy spellings admins might type into app_settings; anything else reads as off. */
function isOn(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'on' || v === 'yes'
}

/**
 * Whether automated email may go out right now.
 *
 * Resolution order:
 *   1. AUTOMATED_EMAIL=off in the environment — hard stop, no DB access needed.
 *   2. app_settings.automated_email_enabled — the admin toggle in Settings.
 *   3. Key absent — enabled, so environments that never ran migration 095 are unchanged.
 *
 * On a DB error we fail CLOSED (no send). A transient blip should not resume a drip
 * blast the admin deliberately paused, and every caller degrades safely: crons retry
 * on the next tick, and the internal alerts still write their in-app notifications.
 */
export async function automatedEmailEnabled(): Promise<boolean> {
  if (String(process.env.AUTOMATED_EMAIL ?? '').trim().toLowerCase() === 'off') return false

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', AUTOMATED_EMAIL_KEY)
      .maybeSingle()

    if (error) throw error
    if (!data) return true

    return isOn(String(data.value))
  } catch (e) {
    console.error('[automated-email] could not read the toggle — holding automated email', e)
    return false
  }
}
