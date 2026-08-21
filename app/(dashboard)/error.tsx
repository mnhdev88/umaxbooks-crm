'use client'

/**
 * Error boundary for the dashboard.
 *
 * WHY: there was no error.tsx anywhere in the app, so a single throw — one
 * timed-out query, one table a migration had not created yet — took out the
 * whole screen and rendered Next's bare "Application error: a server-side
 * exception has occurred". Users reported that as "the CRM stopped working",
 * with nothing on screen to say which part broke or that a retry might work.
 *
 * The nav and sidebar live in the layout, which stays mounted around this, so a
 * failed page no longer costs the user the rest of the app.
 */

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next strips
    // from the client payload in production. Logging it here means a user can
    // read the code off their screen and it can be matched to the server log.
    console.error('[dashboard] render failed', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
        <AlertTriangle className="h-6 w-6 text-orange-500" />
      </div>

      <h2 className="mb-2 text-lg font-semibold text-white">This page didn&apos;t load</h2>

      <p className="mb-6 max-w-md text-sm text-slate-400">
        Something went wrong rendering this page. The rest of the CRM is still
        working — you can retry, or use the sidebar to go somewhere else.
      </p>

      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
      >
        <RotateCw className="h-4 w-4" />
        Try again
      </button>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-slate-600">
          Reference: {error.digest}
        </p>
      )}
    </div>
  )
}
