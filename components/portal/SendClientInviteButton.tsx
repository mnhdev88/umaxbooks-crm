'use client'

import { useState } from 'react'
import { Send, CheckCircle, UserPlus, Mail } from 'lucide-react'
import { Lead } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function SendClientInviteButton({ lead }: { lead: Lead }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [email, setEmail]         = useState(lead.email ?? '')
  const [fullName, setFullName]   = useState(lead.name ?? '')
  const [loading, setLoading]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Only show for Live or Completed leads
  if (lead.status !== 'Live' && lead.status !== 'Completed') {
    return (
      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <UserPlus size={12} />
        Available once lead is marked Live or Completed
      </p>
    )
  }

  function openModal() {
    // Reset state each time the modal opens
    setEmail(lead.email ?? '')
    setFullName(lead.name ?? '')
    setError(null)
    setModalOpen(true)
  }

  async function sendInvite() {
    if (!email.trim()) {
      setError('Email address is required')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/client-invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:     email.trim(),
          full_name: fullName.trim() || email.split('@')[0],
          lead_id:   lead.id,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? `Server error (${res.status})`)
        setLoading(false)
        return
      }

      setSent(true)
      setModalOpen(false)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-sm">
        <CheckCircle size={14} />
        Invite sent to {email}
      </div>
    )
  }

  return (
    <>
      <button
        onClick={openModal}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500
                   hover:bg-orange-600 text-white text-sm font-medium transition-colors"
      >
        <Send size={13} />
        Send Client Portal Invite
      </button>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Send Client Portal Invite"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            An invite link will be emailed to the client. They can use it to log in to their
            portal at <span className="text-slate-300">/portal</span> and see their project details.
          </p>

          <Input
            id="invite-email"
            label="Client Email Address"
            type="email"
            placeholder="client@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={error && !email.trim() ? 'Email is required' : undefined}
            autoFocus
          />

          <Input
            id="invite-name"
            label="Client Full Name"
            type="text"
            placeholder="e.g. John Smith"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
          />

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
              <p className="text-red-400 text-xs font-medium mb-0.5">Failed to send invite</p>
              <p className="text-red-300/80 text-xs">{error}</p>
              {error.toLowerCase().includes('redirect') && (
                <p className="text-red-300/60 text-xs mt-1">
                  Tip: Add your app URL to Supabase → Authentication → URL Configuration → Redirect URLs
                </p>
              )}
              {error.toLowerCase().includes('already') && (
                <p className="text-red-300/60 text-xs mt-1">
                  Tip: This email already has a Supabase account. Check if a client profile already exists.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={sendInvite}
              loading={loading}
              disabled={!email.trim()}
            >
              <Mail size={13} />
              Send Invite
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
