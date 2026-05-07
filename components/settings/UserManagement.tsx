'use client'

import { useState } from 'react'
import { Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShieldCheck, AlertCircle, Edit2, Trash2 } from 'lucide-react'

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
  const [showAddModal, setShowAddModal] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const supabase = createClient()

  function openAdd() {
    setError(null)
    setForm(EMPTY_FORM)
    setShowAddModal(true)
  }

  function openEdit(u: Profile) {
    setError(null)
    setForm({ email: u.email, full_name: u.full_name, password: '', role: u.role })
    setEditUser(u)
  }

  function syncUsers() {
    supabase.from('profiles').select('*').order('created_at', { ascending: true })
      .then(({ data }) => { if (data) setUsers(data as Profile[]) })
  }

  async function handleCreate() {
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      setError('All fields are required.')
      return
    }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const text = await res.text()
      let json: any = {}
      try { json = JSON.parse(text) } catch {}
      if (!res.ok) { setError(json.error || `Server error ${res.status}`); return }

      setShowAddModal(false)
      setForm(EMPTY_FORM)
      setSuccess(`${form.full_name} added successfully.`)
      setTimeout(() => setSuccess(null), 4000)
      syncUsers()
    } catch (e: any) {
      setError(`Request failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate() {
    if (!editUser) return
    if (!form.full_name.trim() || !form.email.trim()) { setError('Name and email are required.'); return }
    if (form.password && form.password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/update-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: editUser.id, ...form }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Update failed'); return }

      setEditUser(null)
      setSuccess(`${form.full_name} updated successfully.`)
      setTimeout(() => setSuccess(null), 4000)
      syncUsers()
    } catch (e: any) {
      setError(`Request failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(u: Profile) {
    if (!confirm(`Delete ${u.full_name}? This cannot be undone.`)) return
    setDeletingId(u.id)
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error || 'Delete failed'); return }
      setUsers(prev => prev.filter(x => x.id !== u.id))
      setSuccess(`${u.full_name} deleted.`)
      setTimeout(() => setSuccess(null), 4000)
    } finally {
      setDeletingId(null)
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
        <Button size="sm" onClick={openAdd}>
          <Plus size={14} /> Add User
        </Button>
      </div>

      <div className="divide-y divide-slate-800">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {u.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-200 truncate">{u.full_name}</p>
                  {u.id === currentUserId && (
                    <span className="text-[10px] text-slate-500 flex-shrink-0">(you)</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">{u.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[u.role] || 'bg-slate-700 text-slate-300'}`}>
                {u.role}
              </span>
              <button
                onClick={() => openEdit(u)}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-700 transition-colors"
                title="Edit user"
              >
                <Edit2 size={12} />
              </button>
              {u.id !== currentUserId && (
                <button
                  onClick={() => handleDelete(u)}
                  disabled={deletingId === u.id}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-700 transition-colors disabled:opacity-40"
                  title="Delete user"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add User Modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add User">
        <UserForm
          form={form}
          setForm={setForm}
          error={error}
          loading={loading}
          onSubmit={handleCreate}
          onCancel={() => setShowAddModal(false)}
          submitLabel="Add User"
          passwordRequired
        />
      </Modal>

      {/* Edit User Modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Edit User">
        <UserForm
          form={form}
          setForm={setForm}
          error={error}
          loading={loading}
          onSubmit={handleUpdate}
          onCancel={() => setEditUser(null)}
          submitLabel="Save Changes"
          passwordRequired={false}
        />
      </Modal>
    </div>
  )
}

interface UserFormProps {
  form: { email: string; full_name: string; password: string; role: string }
  setForm: (fn: (f: any) => any) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  passwordRequired: boolean
}

function UserForm({ form, setForm, error, loading, onSubmit, onCancel, submitLabel, passwordRequired }: UserFormProps) {
  return (
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
        onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
      />
      <Input
        label="Email"
        type="email"
        placeholder="john@agency.com"
        value={form.email}
        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
      />
      <Input
        label={passwordRequired ? 'Password' : 'New Password (leave blank to keep current)'}
        type="password"
        placeholder="Min. 6 characters"
        value={form.password}
        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
      />
      <Select
        label="Role"
        options={[
          { value: 'agent', label: 'Agent' },
          { value: 'sales_agent', label: 'Sales Agent' },
          { value: 'developer', label: 'Developer' },
          { value: 'admin', label: 'Admin' },
        ]}
        value={form.role}
        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button onClick={onSubmit} loading={loading}>{submitLabel}</Button>
      </div>
    </div>
  )
}
