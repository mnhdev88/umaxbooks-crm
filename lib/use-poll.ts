'use client'

import { useEffect, useRef } from 'react'

/**
 * setInterval that stops while the tab is in the background.
 *
 * WHY: agents keep the CRM open all day across several tabs, and every poll here
 * costs two auth checks plus a query. The SMS thread alone ticked every 5s per
 * open tab whether or not anyone was looking at it, and together with the inbox
 * and sidebar polls that traffic was the bulk of ~19,700 daily auth calls and
 * made `profiles` the busiest table in the project.
 *
 * A background tab has nobody watching it, so its ticks buy nothing — the
 * visibility listener drops them, and the immediate poll on refocus means the
 * user still sees current data the moment they look back. Browsers already
 * throttle background timers, but only to ~1/minute and only once the tab has
 * been hidden a while; this stops them outright.
 *
 * @param fn      polled callback — kept in a ref, so it need not be memoized
 * @param ms      interval while the tab is visible
 * @param enabled set false to suspend polling entirely
 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  // Held in a ref so a caller can pass an inline arrow without the interval
  // resubscribing on every render. Written in an effect, not during render, so
  // a discarded render can't leave a stale callback behind.
  const saved = useRef(fn)
  useEffect(() => {
    saved.current = fn
  })

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const start = () => {
      if (timer) return
      timer = setInterval(() => saved.current(), ms)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Catch up first: the tab may have been hidden for far longer than `ms`,
        // so waiting a full interval would show the user stale data.
        saved.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}
