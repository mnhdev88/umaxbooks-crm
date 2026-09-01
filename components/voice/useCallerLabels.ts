'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * phone_number → label for our own outbound numbers, so a call can say
 * "Novelio Technologies · 650" instead of only "+1 650 760 9521".
 *
 * Read straight from the client: caller_numbers carries an "Authenticated can read
 * caller numbers" RLS policy (091), so this needs no API route. The admin-only policy
 * beside it covers writes.
 *
 * ALL rows are loaded, not just is_active ones. Call history outlives the pool — a
 * number that was rested (108) or retired still labelled the calls it placed, and
 * dropping to a bare number on exactly the old calls someone is investigating would
 * defeat the point.
 *
 * Cached at module scope because CallCard calls this per row: a list of forty calls
 * must not become forty requests. The in-flight promise is shared too, so cards
 * mounting in the same tick queue behind one fetch rather than racing. The pool is a
 * dozen rows that change a few times a year, so a per-session cache is fine — a label
 * edited in Settings shows up on the next full page load.
 */

export interface CallerLabels {
  /** E.164 → label, for a call row that records the number it went out on. */
  byNumber: Record<string, string | null>
  /** caller_numbers.id → the row, for the dialer, which knows the agent's pick as an id. */
  byId: Record<string, { phone_number: string; label: string | null }>
}

const EMPTY: CallerLabels = { byNumber: {}, byId: {} }

let cache: CallerLabels | null = null
let inFlight: Promise<CallerLabels> | null = null

function load(): Promise<CallerLabels> {
  if (cache) return Promise.resolve(cache)
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const { data, error } = await createClient()
        .from('caller_numbers')
        .select('id, phone_number, label')
      // A failed lookup is not worth surfacing — the caller falls back to the raw
      // number, which is still correct, just less readable. Left uncached so the
      // next mount retries.
      if (error) {
        console.warn('[caller-labels] could not load caller number labels', error.message)
        return EMPTY
      }
      const out: CallerLabels = { byNumber: {}, byId: {} }
      for (const r of (data || []) as { id: string; phone_number: string; label: string | null }[]) {
        out.byNumber[r.phone_number] = r.label
        out.byId[r.id] = { phone_number: r.phone_number, label: r.label }
      }
      cache = out
      return out
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Our own numbers, by E.164 and by id. Empty until loaded — never null. */
export function useCallerLabels(): CallerLabels {
  const [labels, setLabels] = useState<CallerLabels>(() => cache || EMPTY)

  useEffect(() => {
    if (cache) return
    let active = true
    load().then(m => { if (active) setLabels(m) })
    return () => { active = false }
  }, [])

  return labels
}
