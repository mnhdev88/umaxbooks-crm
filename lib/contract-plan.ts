// Installment ("EMI") plan maths for service agreements.
//
// The rep picks a total, a down payment due at signing, and a number of monthly
// payments. Everything else — the per-month figure and the dated schedule — is
// derived here so the modal, the API, the signing page, the PDF and the client
// portal all agree on the same numbers.
//
// All money is computed in integer cents and only converted to dollars at the
// end, so the schedule always sums back to exactly the total.

export const CONTRACT_PACKAGES = [
  'Website Development',
  'Startup – Basic Website Design',
  'Professional – Advanced Design + SEO',
  'Enterprise – Full Suite + Support',
]

export const MIN_MONTHS = 2
export const MAX_MONTHS = 24

export const MAX_SCOPE_ITEMS    = 25
export const MAX_SCOPE_ITEM_LEN = 200

/**
 * Scope of Services shown to the client in section 4 of the agreement.
 *
 * Used for contracts sent before scope became editable (their scope_items is
 * null), and as the starting point for a package whose defaults an admin has
 * not tailored yet. Deliberately identical for every package — narrowing what
 * a package promises is a business decision, not a migration.
 */
export const DEFAULT_SCOPE_ITEMS: readonly string[] = [
  'Website Design & Development',
  'Mobile Responsive Design',
  'Basic SEO Setup',
  'Contact Form Setup',
  'SSL Installation and Hosting Setup',
  'Google Business Profile Guidance',
  'Minor Content / Layout Adjustments',
]

export interface PackageDefault {
  /** Suggested total contract value in USD. */
  total: number
  /** Suggested down payment as a percentage of the total (0–100). */
  down_pct: number
  /** Suggested number of monthly payments. */
  months: number
  /** Suggested Scope of Services lines the contract modal pre-fills. */
  scope: string[]
}

export type PackageDefaults = Record<string, PackageDefault>

/** Used when app_settings has no row yet, or holds something unparseable. */
export const FALLBACK_PACKAGE_DEFAULTS: PackageDefaults = {
  // Priced per project, so it suggests no figures — the rep types the total and
  // down payment for the build they actually sold.
  'Website Development':                  { total: 0,    down_pct: 0,  months: MIN_MONTHS, scope: [...DEFAULT_SCOPE_ITEMS] },
  'Startup – Basic Website Design':       { total: 799,  down_pct: 50, months: 3, scope: [...DEFAULT_SCOPE_ITEMS] },
  'Professional – Advanced Design + SEO': { total: 1499, down_pct: 50, months: 4, scope: [...DEFAULT_SCOPE_ITEMS] },
  'Enterprise – Full Suite + Support':    { total: 2999, down_pct: 50, months: 6, scope: [...DEFAULT_SCOPE_ITEMS] },
}

export interface ScheduleRow {
  kind: 'down' | 'installment'
  label: string
  amount: number
  /** yyyy-mm-dd */
  due_date: string
}

export interface InstallmentPlan {
  total: number
  down: number
  months: number
  /** Amount of each of the first (months - 1) payments. */
  monthly: number
  /** Final payment — carries any leftover cents, so it can differ by a cent or two. */
  finalMonthly: number
  /** Total financed over the monthly payments (total minus down payment). */
  financed: number
  schedule: ScheduleRow[]
  /** Null when the plan is valid; otherwise a message safe to show the user. */
  error: string | null
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Add `n` calendar months to a yyyy-mm-dd date, clamping to the end of the
 * target month (Jan 31 + 1 month = Feb 28). Pure string maths — no Date
 * parsing — so it never shifts a day across a timezone boundary.
 */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return iso
  const target = m - 1 + n
  const year   = y + Math.floor(target / 12)
  const month  = ((target % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2026-09-10" → "Sep 10, 2026". Built from the string parts, never from Date. */
export function prettyDate(iso: string): string {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return iso || ''
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`
}

export function usd(n: number): string {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

export interface InstallmentPlanInput {
  total: number
  down: number
  months: number
  /** Service start date, yyyy-mm-dd. The down payment falls on this date. */
  startDate: string
}

/**
 * Build a down-payment + N-equal-months plan. Always returns a plan object;
 * check `.error` before trusting the numbers.
 */
export function buildInstallmentPlan({ total, down, months, startDate }: InstallmentPlanInput): InstallmentPlan {
  const t = round2(total)
  const d = round2(down)
  const n = Math.trunc(Number(months))

  const empty = (error: string): InstallmentPlan => ({
    total: t, down: d, months: n, monthly: 0, finalMonthly: 0, financed: 0, schedule: [], error,
  })

  if (!(t > 0))                                 return empty('Enter a total amount greater than 0.')
  if (!(d >= 0))                                return empty('Down payment cannot be negative.')
  if (d >= t)                                   return empty('Down payment must be less than the total amount.')
  if (!Number.isFinite(n) || n < MIN_MONTHS || n > MAX_MONTHS) {
    return empty(`Number of monthly payments must be between ${MIN_MONTHS} and ${MAX_MONTHS}.`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) {
    return empty('A valid service start date is required to build the payment schedule.')
  }

  const financedCents = Math.round(t * 100) - Math.round(d * 100)
  const baseCents     = Math.floor(financedCents / n)
  const finalCents    = financedCents - baseCents * (n - 1)

  const monthly      = baseCents / 100
  const finalMonthly = finalCents / 100

  const schedule: ScheduleRow[] = []
  if (d > 0) {
    schedule.push({ kind: 'down', label: 'Down payment (due at signing)', amount: d, due_date: startDate })
  }
  // With a down payment the monthly run starts a month later; without one the
  // first monthly payment is itself due on the start date.
  const offset = d > 0 ? 1 : 0
  for (let i = 1; i <= n; i++) {
    schedule.push({
      kind: 'installment',
      label: `Payment ${i} of ${n}`,
      amount: i === n ? finalMonthly : monthly,
      due_date: addMonths(startDate, i - 1 + offset),
    })
  }

  return { total: t, down: d, months: n, monthly, finalMonthly, financed: financedCents / 100, schedule, error: null }
}

/** Narrow an untrusted jsonb value into a schedule, or [] if it isn't one. */
export function readSchedule(value: unknown): ScheduleRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is ScheduleRow =>
      !!r && typeof r === 'object' &&
      typeof (r as ScheduleRow).label === 'string' &&
      typeof (r as ScheduleRow).due_date === 'string' &&
      Number.isFinite(Number((r as ScheduleRow).amount)),
  )
}

/**
 * Narrow an untrusted value into scope lines: trims, drops blanks and
 * duplicates, caps the length of each line and the number of lines. Returns []
 * when nothing usable is left, so callers can decide between rejecting the
 * input and falling back to a default list.
 */
export function sanitizeScopeItems(value: unknown): string[] {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []

  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const line = entry.trim().replace(/\s+/g, ' ').slice(0, MAX_SCOPE_ITEM_LEN)
    if (!line || out.includes(line)) continue
    out.push(line)
    if (out.length === MAX_SCOPE_ITEMS) break
  }
  return out
}

/**
 * The scope lines to render for a contract. Agreements sent before the scope
 * became editable have no stored list and keep showing the original wording.
 */
export function readScopeItems(value: unknown): string[] {
  const items = sanitizeScopeItems(value)
  return items.length > 0 ? items : [...DEFAULT_SCOPE_ITEMS]
}

/** Coerce an untrusted app_settings value into package defaults. */
export function readPackageDefaults(value: unknown): PackageDefaults {
  let raw: any = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return { ...FALLBACK_PACKAGE_DEFAULTS } }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...FALLBACK_PACKAGE_DEFAULTS }

  const out: PackageDefaults = {}
  for (const pkg of CONTRACT_PACKAGES) {
    const row = raw[pkg]
    const fb  = FALLBACK_PACKAGE_DEFAULTS[pkg]
      || { total: 0, down_pct: 50, months: 3, scope: [...DEFAULT_SCOPE_ITEMS] }
    const scope = sanitizeScopeItems(row?.scope)
    out[pkg] = {
      total:    clamp(Number(row?.total), 0, 1_000_000, fb.total),
      down_pct: clamp(Number(row?.down_pct), 0, 100, fb.down_pct),
      months:   Math.trunc(clamp(Number(row?.months), MIN_MONTHS, MAX_MONTHS, fb.months)),
      scope:    scope.length > 0 ? scope : [...fb.scope],
    }
  }
  return out
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
