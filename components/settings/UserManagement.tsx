'use client'

import { useState } from 'react'
import { Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShieldCheck, AlertCircle } from 'lucide-react'

const ROLE_OPTIONS = [
  { value: 'agent',       label: 'Agent' },
  { value: 'sales_agent', label: 'Sales Agent' },
  { value: 'developer',   label: 'Developer' },
  { value: 'admin',       label: 'Admin' },
]

const ROLE_COLORS: Record<string, string> = {
  admin:       'text-orange-400 bg-orange-900/30',
  agent:       'text-blue-400 bg-blue-900/30',
  sales_agent: 'text-green-400 bg-green-900/30',
  developer:   'text-purple-400 bg-purple-900/30',
}

interface UserManagementProps {
  users: Profile[]
  currentUserId: string
}

const EMPTY_FORM = { email: '', full_name: '', password: '', role: 'agent' }

export function UserManagement({ users: initialUsers, currentUserId }: UserManagementProps) {
  const [users, setUsers] = useState<Profile[]>(initialUsers)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const supabase = createClient()

  function openModal() {
    setError(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  async function handleCreate() {
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      setError('All fields are required.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const text = await res.text()
      let json: any = {}
      try { json = JSON.parse(text) } catch {}

      if (!res.ok) {
        setError(json.error || `Server error ${res.status}`)
        setLoading(false)
        return
      }

      // Add new user to list immediately without waiting for DB query
      const newUser: Profile = {
        id: json.userId || crypto.randomUUID(),
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        role: form.role as Profile['role'],
        created_at: new Date().toISOString(),
      }
      setUsers(prev => [...prev, newUser])
      setShowModal(false)
      setForm(EMPTY_FORM)
      setSuccess(`${form.full_name} added successfully.`)
      setTimeout(() => setSuccess(null), 4000)

      // Sync with DB in background to get accurate data
      supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
        .then(({ data }) => { if (data) setUsers(data as Profile[]) })
    } catch (e: any) {
      setError(`Request failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole as Profile['role'] } : u))
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    if (error) {
      // revert on failure
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: users.find(x => x.id === userId)?.role || u.role } : u))
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {success && (
        <div className="px-5 py-3 bg-green-900/30 border-b border-green-800 text-sm text-green-300 flex items-center gap-2">
          <ShieldCheck size={14} /> {success}
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Team Members</h2>
          <p className="text-xs text-slate-500 mt-0.5">{users.length} users</p>
        </div>
        <Button size="sm" onClick={openModal}>
          <Plus size={14} /> Add User
        </Button>
      </div>

      <div className="divide-y divide-slate-800">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold">
                {u.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-200">{u.full_name}</p>
                  {u.id === currentUserId && (
                    <span className="text-[10px] text-slate-500">(you)</span>
                  )}
                </div>
                <p className="text-xs text-slate-500">{u.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[u.role] || 'bg-slate-700 text-slate-300'}`}>
                {u.role}
              </span>
              {u.id !== currentUserId && (
                <select
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                  className="text-xs bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add User">
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Input
            label="Full Name"
            placeholder="John Smith"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          />
          <Input
            label="Email"
            type="email"
            placeholder="john@agency.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Input
            label="Password"
            type="password"
            placeholder="Min. 6 characters"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleCreate} loading={loading}>Add User</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
