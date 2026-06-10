// Shared date-range resolution for the Reports page and its KPI API, so both
// interpret the ?from=/?to= URL params identically.
//
// `from`/`to` are calendar dates in `YYYY-MM-DD` form (what <input type="date">
// produces). We turn them into a half-open [fromISO, toISO) interval at LOCAL
// day boundaries — `toISO` is the start of the day AFTER `to`, so the whole
// `to` day is included. Either bound may be null (open-ended / all-time).

export interface ResolvedRange {
  fromISO: string | null
  toISO: string | null   // exclusive upper bound
  label: string
}

function parseDateParts(s?: string): { y: number; m: number; d: number } | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  return { y: +m[1], m: +m[2], d: +m[3] }
}

// Local midnight of the given date, as an ISO timestamp.
function localMidnightISO(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d).toISOString()
}

export function resolveRange(from?: string, to?: string): ResolvedRange {
  const f = parseDateParts(from)
  const t = parseDateParts(to)

  const fromISO = f ? localMidnightISO(f.y, f.m, f.d) : null
  // exclusive: start of the day after `to`
  const toISO = t ? new Date(t.y, t.m - 1, t.d + 1).toISOString() : null

  let label: string
  if (!f && !t) label = 'All Time'
  else if (f && t && from === to) label = formatLabel(f)
  else if (f && t) label = `${formatLabel(f)} – ${formatLabel(t)}`
  else if (f) label = `From ${formatLabel(f)}`
  else label = `Until ${formatLabel(t!)}`

  return { fromISO, toISO, label }
}

function formatLabel(p: { y: number; m: number; d: number }): string {
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
