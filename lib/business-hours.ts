import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_REPORT_TZ } from './reporting-day'

/**
 * Is our office open right now? Used to send inbound callers straight to voicemail
 * outside working hours instead of ringing phones nobody is sitting next to.
 *
 * Not to be confused with lib/call-window.ts: that answers "may we dial this LEAD
 * right now", in the lead's own US timezone, for TCPA compliance. This answers "is
 * anyone here", in our timezone. The wall-clock maths is the same shape; the meaning
 * and the configuration are not.
 *
 * The timezone comes from app_settings.report_timezone (074) rather than a key of its
 * own — that setting already means "the business's timezone", and a second copy would
 * eventually disagree with the first.
 */

export const DEFAULT_BUSINESS_HOURS = {
  open: '09:30',
  close: '18:00',
  days: [1, 2, 3, 4, 5], // ISO: 1 = Mon … 7 = Sun
} as const

export interface BusinessHours {
  open: string
  close: string
  /** ISO day numbers the office is staffed. */
  days: number[]
  tz: string
}

/** "HH:MM" → minutes since midnight, or null if malformed. */
function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** "1,2,3" → [1,2,3]. Ignores junk; returns null if nothing valid survives. */
function parseDays(s: string | undefined): number[] | null {
  if (!s) return null
  const days = s
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return days.length ? Array.from(new Set(days)).sort() : null
}

export function parseBusinessHours(
  open?: string,
  close?: string,
  days?: string,
  tz?: string
): BusinessHours {
  return {
    open: parseHM(open || '') !== null ? open!.trim() : DEFAULT_BUSINESS_HOURS.open,
    close: parseHM(close || '') !== null ? close!.trim() : DEFAULT_BUSINESS_HOURS.close,
    days: parseDays(days) ?? [...DEFAULT_BUSINESS_HOURS.days],
    tz: tz || DEFAULT_REPORT_TZ,
  }
}

/** Wall clock in an IANA zone → minutes since midnight + ISO weekday (1=Mon). */
function zoneNow(timeZone: string, now: Date): { minutes: number; isoDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const h = parseInt(get('hour'), 10) % 24
  const m = parseInt(get('minute'), 10)
  // Intl gives a localised weekday name; map it rather than trusting Date.getDay(),
  // which would report the SERVER's day and can be off by one across midnight.
  const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'))
  return { minutes: h * 60 + m, isoDay: idx + 1 }
}

/**
 * True when the office is currently staffed.
 *
 * A close time at or before the open time is treated as open-ended (i.e. the office
 * closes at midnight) rather than as a window that can never match — a fat-fingered
 * '18:00'–'09:30' should leave phones ringing, not silently divert every caller.
 */
export function isOpenNow(hours: BusinessHours, now: Date): boolean {
  let minutes: number
  let isoDay: number
  try {
    ;({ minutes, isoDay } = zoneNow(hours.tz, now))
  } catch {
    return true // Unknown zone: fail open (see readBusinessHours).
  }
  if (Number.isNaN(minutes) || isoDay < 1) return true

  if (!hours.days.includes(isoDay)) return false

  const openM = parseHM(hours.open) ?? parseHM(DEFAULT_BUSINESS_HOURS.open)!
  const closeM = parseHM(hours.close) ?? parseHM(DEFAULT_BUSINESS_HOURS.close)!
  if (closeM <= openM) return minutes >= openM

  return minutes >= openM && minutes <= closeM
}

/**
 * Read the configured hours from app_settings.
 *
 * Fails OPEN: on any error the caller gets the defaults, and a bad read at 11am must
 * not divert every caller to voicemail. This is the opposite of automated-email.ts,
 * which fails closed — correct there, because a wrongly-sent email can't be recalled,
 * whereas a wrongly-rung phone is just a call someone picks up.
 */
export async function readBusinessHours(client: SupabaseClient): Promise<BusinessHours> {
  try {
    const { data } = await client
      .from('app_settings')
      .select('key, value')
      .in('key', ['business_open', 'business_close', 'business_days', 'report_timezone'])
    const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
    return parseBusinessHours(
      map['business_open'],
      map['business_close'],
      map['business_days'],
      map['report_timezone']
    )
  } catch {
    return parseBusinessHours()
  }
}
