'use client'

/**
 * Shared "Log Call" modal — the single call-logging flow used both from the lead's
 * Calls & Appointments tab and from the dialer's post-call wrap-up. Saves an
 * appointments row, optionally schedules a follow-up callback (timezone-aware),
 * completes pending follow-ups, moves the lead status (Contacted / Callback Booked)
 * and drops an activity log entry.
 *
 * userId and zipCode are optional so the dialer (which only knows the leadId) can
 * mount it anywhere: the auth user is resolved on save, and the lead's ZIP is
 * fetched on open when not supplied.
 */

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { US_TIMEZONES, getTimezoneFromZip, localToUTC, formatDualTime } from '@/lib/timezone'
import { toast } from 'sonner'
import { Phone, Bell, Globe, MapPin } from 'lucide-react'

interface LogCallModalProps {
  open: boolean
  onClose: () => void
  leadId: string
  /** Current user id; resolved from the session on save when omitted. */
  userId?: string
  /** Lead ZIP for follow-up timezone; fetched from the lead when omitted. */
  zipCode?: string
  /** Prefill for the outcome notes (e.g. notes typed in the dialer wrap-up). */
  initialNotes?: string
  onSaved?: () => void
}

const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const label = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m} ${h < 12 ? 'AM' : 'PM'}`
  const value = `${String(h).padStart(2, '0')}:${m}`
  return { value, label }
})

// Agents sometimes log a call a day or two after it happened, so allow the
// Call Date to be back-dated up to 2 days (but not into the future beyond today).
function minCallDate() {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  return d.toLocaleDateString('en-CA')
}

function emptyForm(initialNotes?: string) {
  return {
    call_date: new Date().toLocaleDateString('en-CA'),
    outcome_notes: initialNotes || '',
    follow_up_date: '',
    follow_up_time: '',
    follow_up_notes: '',
  }
}

export function LogCallModal({ open, onClose, leadId, userId, zipCode, initialNotes, onSaved }: LogCallModalProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(() => emptyForm(initialNotes))
  const [fetchedZip, setFetchedZip] = useState<string | null>(null)

  // Reset the form each time the modal opens, carrying over the caller's notes.
  useEffect(() => {
    if (open) setForm(emptyForm(initialNotes))
  }, [open, initialNotes])

  // The dialer doesn't know the lead's ZIP — fetch it so the follow-up time
  // converts from the client's local timezone, same as the tab flow.
  useEffect(() => {
    if (!open || zipCode !== undefined) return
    let cancelled = false
    supabase
      .from('leads')
      .select('zip_code')
      .eq('id', leadId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setFetchedZip(data?.zip_code ?? null)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId, zipCode])

  const zip = zipCode ?? fetchedZip ?? undefined
  const tzFromZip = useMemo(() => (zip ? getTimezoneFromZip(zip) : null), [zip])
  const tzInfo = tzFromZip ?? US_TIMEZONES[0]
  const selectedTz = tzInfo.tz

  const followUpPreview = useMemo(() => {
    if (!form.follow_up_date || !form.follow_up_time || !selectedTz) return null
    const utcISO = localToUTC(`${form.follow_up_date}T${form.follow_up_time}`, selectedTz)
    if (!utcISO) return null
    return formatDualTime(utcISO, selectedTz, tzInfo.abbr)
  }, [form.follow_up_date, form.follow_up_time, selectedTz, tzInfo.abbr])

  async function handleSave() {
    if (!form.call_date) return
    setLoading(true)
    try {
      const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
      if (!uid) {
        toast.error('Not signed in.')
        return
      }

      await supabase.from('appointments').insert({
        lead_id: leadId,
        created_by: uid,
        call_date: form.call_date,
        outcome_notes: form.outcome_notes || null,
      })

      // Auto-complete any pending follow-ups for this lead
      await supabase
        .from('follow_ups')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('lead_id', leadId)
        .eq('user_id', uid)
        .eq('status', 'pending')

      // Schedule new follow-up if requested
      if (form.follow_up_date) {
        const timeLocal = form.follow_up_time || '09:00'
        const scheduledAt =
          localToUTC(`${form.follow_up_date}T${timeLocal}`, selectedTz) ||
          new Date(`${form.follow_up_date}T${timeLocal}`).toISOString()

        await supabase.from('follow_ups').insert({
          lead_id: leadId,
          user_id: uid,
          scheduled_at: scheduledAt,
          notes: form.follow_up_notes || form.outcome_notes || null,
          status: 'pending',
        })
      }

      const newStatus = form.follow_up_date ? 'Callback Booked' : 'Contacted'
      const statusRes = await fetch('/api/leads/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, status: newStatus }),
      })
      if (!statusRes.ok) {
        const err = await statusRes.json().catch(() => ({}))
        toast.error(`Failed to update lead status: ${err.error || statusRes.statusText}`)
      }

      await supabase.from('activity_logs').insert({
        lead_id: leadId,
        user_id: uid,
        action: 'Call Logged',
        details: form.outcome_notes
          ? `Call on ${form.call_date} — ${form.outcome_notes.slice(0, 80)}`
          : `Call logged on ${form.call_date}`,
      })

      toast.success('Call logged.')
      onClose()
      onSaved?.()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Log Call">
      <div className="space-y-4">
        <Input
          label="Call Date"
          type="date"
          value={form.call_date}
          min={minCallDate()}
          max={new Date().toLocaleDateString('en-CA')}
          onChange={(e) => setForm(f => ({ ...f, call_date: e.target.value }))}
        />
        <TextArea
          label="Outcome / Notes"
          value={form.outcome_notes}
          rows={4}
          onChange={(e) => setForm(f => ({ ...f, outcome_notes: e.target.value }))}
          placeholder="What happened on this call?"
        />
        {/* Optional follow-up callback */}
        <div className="border border-slate-700 rounded-xl p-4 space-y-3 bg-slate-800/40">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-orange-400" />
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Schedule Follow-up Callback</p>
            <span className="text-xs text-slate-600">(optional)</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={form.follow_up_date}
              min={new Date().toLocaleDateString('en-CA')}
              onChange={(e) => setForm(f => ({ ...f, follow_up_date: e.target.value }))}
              className="flex-1"
            />
            <Select
              options={TIME_SLOTS}
              placeholder="-- Time --"
              value={form.follow_up_time}
              onChange={(e) => setForm(f => ({ ...f, follow_up_time: e.target.value }))}
            />
          </div>
          {form.follow_up_date && (
            <Input
              placeholder="Reminder note (e.g. client wants to discuss pricing)"
              value={form.follow_up_notes}
              onChange={(e) => setForm(f => ({ ...f, follow_up_notes: e.target.value }))}
            />
          )}
          {followUpPreview && (
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Time Preview</p>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Globe size={12} className="text-orange-400 flex-shrink-0" />
                {followUpPreview.us}
              </div>
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <MapPin size={12} className="text-blue-400 flex-shrink-0" />
                {followUpPreview.ist}
                {followUpPreview.nextDayIST && (
                  <span className="text-[10px] font-semibold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">+1 day</span>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500">Saving will move the lead status to{' '}
          <span className="text-orange-400 font-medium">
            {form.follow_up_date ? 'Callback Booked' : 'Contacted'}
          </span>.
        </p>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={loading} disabled={!form.call_date}>
            <Phone size={13} /> Log Call
          </Button>
        </div>
      </div>
    </Modal>
  )
}
