'use client'

import { useState, useEffect, useId, Suspense } from 'react'
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

  const passwordId = useId()
  const confirmId  = useId()

  useEffect(() => {
    const code = searchParams.get('code')

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          setExchangeError('This invite link has expired or already been used. Please ask your admin to send a new one.')
        }
        setExchanging(false)
      })
      return
    }

    const hash = window.location.hash
    if (hash.includes('access_token=')) {
      const params        = new URLSearchParams(hash.replace(/^#/, ''))
      const accessToken   = params.get('access_token')  ?? ''
      const refreshToken  = params.get('refresh_token') ?? ''

      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            setExchangeError('This invite link has expired or already been used. Please ask your admin to send a new one.')
          }
          setExchanging(false)
        })
      return
    }

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

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'client') {
        await supabase.auth.signOut()
        window.location.href = '/login'
        return
      }
    }

    window.location.href = '/portal'
  }

  const inputCls = 'w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:border-orange-500'

  return (
    <div className="min-h-screen bg-[#07061A] flex items-center justify-center p-4">
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
              <svg className="animate-spin h-4 w-4 text-orange-400" fill="none" viewBox="0 0 24 24" aria-label="Verifying link" role="status">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verifying your invite link…
            </div>
          ) : exchangeError ? (
            <div className="text-center py-4 space-y-3">
              <KeyRound size={32} className="text-slate-600 mx-auto" aria-hidden="true" />
              <p role="alert" className="text-red-400 text-sm">{exchangeError}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-sm text-red-300 text-center">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor={passwordId} className="text-[13px] font-medium text-slate-400">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id={passwordId}
                    type={showPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className={`${inputCls} pr-11`}
                  />
                  <button
                    type="button"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    aria-pressed={showPass}
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-0 top-0 h-full px-3 flex items-center text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 rounded-r-lg"
                  >
                    {showPass ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={confirmId} className="text-[13px] font-medium text-slate-400">
                  Confirm Password
                </label>
                <input
                  id={confirmId}
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  className={inputCls}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-label="Setting up account" role="status">
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
