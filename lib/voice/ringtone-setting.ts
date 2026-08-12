/**
 * Org-wide switch for the inbound-call ringtone (app_settings, admin-controlled).
 *
 * Server-safe on purpose — lib/voice/ringtone.ts is a 'use client' module and can't be
 * imported by an API route, so the key and its parsing live here where both sides reach.
 */

export const RINGTONE_KEY = 'dialer_ringtone_enabled'

/**
 * Absent key = silent. Every other app_settings switch defaults to on when unset, but
 * this one ships off: it was turned off deliberately, and a missing row after a restore
 * should leave the office quiet rather than surprise a room full of agents with sound.
 */
export function parseRingtoneEnabled(value: unknown): boolean {
  if (value == null) return false
  return ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase())
}
