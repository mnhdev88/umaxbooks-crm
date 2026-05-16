'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, KeyRound } from 'lucide-react'

export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm />
    </Suspense>
  )
}

function SetPasswordForm() {
  const supabase      = createClient()
  const searchParams  = useSearchParams()

  const [exchanging, setExchanging]       = useState(true)
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  const [password, setPassword]           = useState('')
  const [confirm, setConfirm]             = useState('')
  const [showPass, setShowPass]           = useState(false)
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  useEffect(() => {
    const code = searchParams.get('code')
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const hasHashToken = hash.includes('access_token=')

    if (code) {
      // PKCE flow: sign out any existing session first so the invite session
      // is established cleanly (handles admin testing in the same browser).
      supabase.auth.signOut().finally(() => {
        supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
          if (error) {
            setExchangeError('This invite link has expired or already been used. Please ask your admin to send a new one.')
          }
          setExchanging(false)
        })
      })
      return
    }

    if (hasHashToken) {
      // Hash/implicit flow: Supabase auto-parses the hash and fires onAuthStateChange.
      // Wait for SIGNED_IN to confirm the invite session was established.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          setExchanging(false)
        }
      })
      // Timeout fallback — if no SIGNED_IN after 8s, show error
      const t = setTimeout(() => {
        subscription.unsubscribe()
        setExchangeError('Could not verify your invite link. Please ask your admin to send a new one.')
        setExchanging(false)
      }, 8000)
      return () => { subscription.unsubscribe(); clearTimeout(t) }
    }

    // No code and no hash token — invalid or already-used link
    setExchangeError('Invalid invite link. Please ask your admin to send a new invite.')
    setExchanging(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }

    // Hard navigation ensures the middleware re-reads the fresh session cookies
    // and the client portal loads with the correct profile (not a stale server cache).
    window.location.href = '/portal'
  }

  return (
    <div className="min-h-screen bg-[#060e1f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-white rounded-2xl px-6 py-3 mb-5 shadow-lg">
            <Image
              src="https://noveliotech.com/logo.png"
              alt="Novelio"
              width={180}
              height={54}
              className="object-contain"
              unoptimized
            />
          </div>
          <p className="text-slate-400 text-sm mt-1">Welcome — set your password to get started</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
          {exchanging ? (
            <div className="flex items-center justify-center gap-3 py-6 text-slate-400 text-sm">
              <svg className="animate-spin h-4 w-4 text-orange-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verifying your invite link…
            </div>
          ) : exchangeError ? (
            <div className="text-center py-4 space-y-3">
              <KeyRound size={32} className="text-slate-600 mx-auto" />
              <p className="text-red-400 text-sm">{exchangeError}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-sm text-red-300 text-center">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2.5 pr-10
                               text-sm text-slate-100 placeholder:text-slate-500
                               focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Confirm Password
                </label>
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2.5
                             text-sm text-slate-100 placeholder:text-slate-500
                             focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5
                           rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2 mt-2"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {loading ? 'Setting up your account…' : 'Set Password & Go to Portal'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
