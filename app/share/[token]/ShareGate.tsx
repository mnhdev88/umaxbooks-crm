'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from './Shell'

/**
 * The last-4 gate. The uuid in the URL is the real secret; this stops a link
 * that was forwarded, mis-typed or left open on a shared screen from showing a
 * client's pricing to someone else.
 *
 * Deliberately asks for four digits rather than the whole number: a full number
 * has to match our formatting to pass, which turns a 5-second check into a
 * support call, and adds no security a 10,000-space check plus a server-side
 * lockout doesn't already give.
 */
export function ShareGate({ token, business }: { token: string; business: string }) {
  const router = useRouter()
  const [value, setValue]   = useState('')
  const [error, setError]   = useState('')
  const [busy, setBusy]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (value.length !== 4 || busy) return
    setBusy(true)
    setError('')
    try {
      const res  = await fetch(`/api/public/share/${token}/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ last4: value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not verify that number.')
      // Server component reads the cookie it just set, so refresh rather than
      // swapping in client-side state.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify that number.')
      setValue('')
      setBusy(false)
    }
  }

  return (
    <Card>
      <div style={{ padding: '38px 30px 34px', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔒</div>
        <h1 style={{ color: '#1F3A93', fontSize: '19px', fontWeight: 700, margin: '0 0 6px' }}>
          Documents for {business}
        </h1>
        <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
          To open your proposal, agreement and website report, enter the <strong style={{ color: '#374151' }}>last 4 digits</strong> of
          the phone number you gave us.
        </p>

        <form onSubmit={submit}>
          <input
            value={value}
            onChange={e => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Last 4 digits of your phone number"
            placeholder="0000"
            autoFocus
            disabled={busy}
            style={{
              width: '170px',
              padding: '13px 10px',
              fontSize: '26px',
              fontWeight: 700,
              letterSpacing: '10px',
              textIndent: '10px',
              textAlign: 'center',
              color: '#111827',
              background: '#f9fafb',
              border: `2px solid ${error ? '#ef4444' : '#d1d5db'}`,
              borderRadius: '12px',
              outline: 'none',
            }}
          />

          {error && (
            <p style={{ color: '#dc2626', fontSize: '13px', margin: '12px 0 0' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={value.length !== 4 || busy}
            style={{
              display: 'block',
              width: '100%',
              marginTop: '20px',
              padding: '13px',
              fontSize: '15px',
              fontWeight: 700,
              color: '#fff',
              background: value.length === 4 && !busy ? '#1F3A93' : '#9ca3af',
              border: 'none',
              borderRadius: '10px',
              cursor: value.length === 4 && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Checking…' : 'View my documents'}
          </button>
        </form>
      </div>
    </Card>
  )
}
