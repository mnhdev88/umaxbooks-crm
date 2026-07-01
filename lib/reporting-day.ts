// Business "reporting day" boundaries. The day is anchored to a business timezone
// and starts at a configurable hour, then runs 24h — so a late shift that crosses
// local midnight stays in ONE day and daily counters don't reset mid-shift.
//
// Both the server (report APIs) and the client (date-filter presets) use these
// pure helpers with the same config, so a calendar date means the same window
// everywhere. Config comes from app_settings (report_timezone / report_day_start_hour).

import { localToUTC } from './timezone'

export const DEFAULT_REPORT_TZ = 'Asia/Kolkata'
export const DEFAULT_DAY_START_HOUR = 6

export interface ReportDayConfig {
  tz: string
  startHour: number
}

// 'YYYY-MM-DD' wall date for an instant in the given timezone.
function dateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

// Hour 0–23 for an instant in the given timezone.
function hourInTz(d: Date, tz: string): number {
  const h = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).format(d), 10)
  return h % 24
}

// Shift a 'YYYY-MM-DD' wall date by whole days (calendar arithmetic, no timezone).
function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// UTC ISO for `startHour:00` local time in `tz` on the given wall date.
function dayStartUTC(ymd: string, tz: string, startHour: number): string {
  const hh = String(startHour).padStart(2, '0')
  return localToUTC(`${ymd}T${hh}:00`, tz)
}

// The reporting date ('YYYY-MM-DD') that `now` falls in — before the start hour we
// still belong to the previous day's shift.
export function reportingDate(now: Date, cfg: ReportDayConfig): string {
  const wallDate = dateInTz(now, cfg.tz)
  const wallHour = hourInTz(now, cfg.tz)
  return wallHour < cfg.startHour ? shiftDate(wallDate, -1) : wallDate
}

// Half-open [fromISO, toISO) window for a single reporting date.
export function reportingDayWindow(date: string, cfg: ReportDayConfig): { fromISO: string; toISO: string } {
  return {
    fromISO: dayStartUTC(date, cfg.tz, cfg.startHour),
    toISO: dayStartUTC(shiftDate(date, 1), cfg.tz, cfg.startHour),
  }
}

// [from, to] calendar dates ('YYYY-MM-DD') → half-open [fromISO, toISO) window whose
// day boundaries sit at the reporting-day start hour in the business timezone.
// Either bound may be omitted (open-ended). Mirrors resolveRange's label logic.
export function resolveReportingRange(
  from: string | undefined,
  to: string | undefined,
  cfg: ReportDayConfig,
): { fromISO: string | null; toISO: string | null; label: string } {
  const f = normalizeDate(from)
  const t = normalizeDate(to)
  const fromISO = f ? dayStartUTC(f, cfg.tz, cfg.startHour) : null
  const toISO = t ? dayStartUTC(shiftDate(t, 1), cfg.tz, cfg.startHour) : null

  let label: string
  if (!f && !t) label = 'All Time'
  else if (f && t && f === t) label = formatLabel(f)
  else if (f && t) label = `${formatLabel(f)} – ${formatLabel(t)}`
  else if (f) label = `From ${formatLabel(f)}`
  else label = `Until ${formatLabel(t!)}`

  return { fromISO, toISO, label }
}

function normalizeDate(s?: string): string | null {
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null
}

function formatLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Coerce raw app_settings strings into a valid config, falling back to defaults.
export function parseReportDayConfig(tz?: string | null, startHour?: string | null): ReportDayConfig {
  const h = Number(startHour)
  return {
    tz: tz && tz.trim() ? tz.trim() : DEFAULT_REPORT_TZ,
    startHour: Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_DAY_START_HOUR,
  }
}
