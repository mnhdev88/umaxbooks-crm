'use client'

/**
 * Last-resort boundary: catches throws in the root layout itself, which the
 * per-section error.tsx files sit inside and therefore cannot catch.
 *
 * This replaces the entire document, so it renders its own <html>/<body> and
 * uses inline styles only — if the root layout failed, the stylesheet it pulls
 * in is exactly the thing we cannot count on.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[root] render failed', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            The CRM hit an unexpected error
          </h1>

          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            This is usually temporary. Reloading fixes most cases — if it keeps
            happening, send the reference below to your developer.
          </p>

          <button
            onClick={reset}
            style={{
              background: '#f97316',
              color: '#fff',
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.6rem 1.1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>

          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#475569' }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
