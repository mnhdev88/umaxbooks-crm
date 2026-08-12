'use client'

import { useState, useEffect, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff } from 'lucide-react'
import Image from 'next/image'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const emailId = useId()
  const passwordId = useId()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('error=')) return
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const code = params.get('error_code')
    if (code === 'otp_expired') {
      setError('Your invite link has expired. Please ask your admin to send a new invite.')
    } else if (params.get('error')) {
      setError('This link is invalid or has already been used. Please ask your admin for a new invite.')
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error, data } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      const status = (error as { status?: number }).status
      const msg = error.message?.toLowerCase() ?? ''
      if (status === 429 || msg.includes('rate')) {
        setError('Too many attempts. Please wait a moment and try again.')
      } else if (msg.includes('not confirmed') || msg.includes('confirm')) {
        setError('Your email is not confirmed yet. Check your inbox or ask your admin to resend the invite.')
      } else if (status === 0 || msg.includes('network') || msg.includes('fetch')) {
        setError('Network error — check your connection and try again.')
      } else {
        setError('Invalid email or password.')
      }
      setLoading(false)
      return
    }

    const userId = data.user?.id
    if (userId) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', userId).single()
      if (profile?.role === 'client') {
        window.location.href = '/portal'
        return
      }
    }

    // Hard navigation, matching the client-role branch above. router.push + refresh raced:
    // the dashboard could paint from the router cache with the *previous* user's props
    // before the refresh landed, handing the new session a stale userId.
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-[#07061A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
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
          <p className="text-slate-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
          {error && (
            <div role="alert" className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-sm text-red-300 text-center">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={emailId} className="text-[13px] font-medium text-slate-400">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@agency.com"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07061A] focus-visible:border-orange-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className="text-[13px] font-medium text-slate-400">
              Password
            </label>
            <div className="relative">
              <input
                id={passwordId}
                type={showPass ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2.5 pr-11 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07061A] focus-visible:border-orange-500"
              />
              <button
                type="button"
                aria-label={showPass ? 'Hide password' : 'Show password'}
                aria-pressed={showPass}
                onClick={() => setShowPass(!showPass)}
                className="absolute right-0 top-0 h-full px-3 flex items-center text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 rounded-r-lg"
              >
                {showPass ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07061A]"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-4">
          Contact admin to create your account.
        </p>
      </div>
    </div>
  )
}
