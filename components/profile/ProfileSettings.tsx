'use client'

import { useState } from 'react'
import { Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ShieldCheck, AlertCircle, User, Lock } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  agent: 'Agent',
  sales_agent: 'Sales Agent',
  developer: 'Developer',
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'text-orange-400 bg-orange-900/30',
  agent: 'text-blue-400 bg-blue-900/30',
  sales_agent: 'text-green-400 bg-green-900/30',
  developer: 'text-purple-400 bg-purple-900/30',
}

export function ProfileSettings({ profile }: { profile: Profile }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleChangePassword() {
    setError(null)
    if (!password) { setError('Enter a new password.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to update password'); return }
      setSuccess(true)
      setPassword('')
      setConfirm('')
      setTimeout(() => setSuccess(false), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Profile Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <User size={15} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-100">Profile Info</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-100">{profile.full_name}</p>
            <p className="text-sm text-slate-400">{profile.email}</p>
            <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[profile.role] || 'bg-slate-700 text-slate-300'}`}>
              {ROLE_LABELS[profile.role] || profile.role}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-600 mt-4">Contact your admin to update your name, email or role.</p>
      </div>

      {/* Change Password */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <Lock size={15} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-100">Change Password</h2>
        </div>

        {success && (
          <div className="mb-4 flex items-center gap-2 text-sm text-green-300 bg-green-900/30 border border-green-800 rounded-lg px-4 py-3">
            <ShieldCheck size={14} /> Password updated successfully.
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="space-y-3">
          <Input
            label="New Password"
            type="password"
            placeholder="Min. 6 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <Input
            label="Confirm Password"
            type="password"
            placeholder="Re-enter new password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          <div className="flex justify-end pt-1">
            <Button onClick={handleChangePassword} loading={loading}>
              Update Password
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
