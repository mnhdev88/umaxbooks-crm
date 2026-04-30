'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Appointment } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { formatDate, formatDateTime } from '@/lib/utils'
import { US_TIMEZONES, getTimezoneFromZip, localToUTC, formatDualTime } from '@/lib/timezone'
import { Plus, Calendar, Video, FileText, ClipboardList, Globe, MapPin, Info } from 'lucide-react'

interface AppointmentTabProps {
  leadId: string
  userId: string
  userRole: string
  zipCode?: string
}

// Shows US + IST for stored appointments that have a timezone
function DualTimeDisplay({ isoStr, timezone }: { isoStr: string; timezone?: string }) {
  if (!timezone) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Calendar size={14} className="text-blue-400" />
        Appointment: {formatDateTime(isoStr)}
      </div>
    )
  }
  const tzInfo = US_TIMEZONES.find(t => t.tz === timezone)
  const { us, ist, nextDayIST } = formatDualTime(isoStr, timezone, tzInfo?.abbr ?? 'ET')
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Globe size={14} className="text-orange-400 flex-shrink-0" />
        <span>{us}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <MapPin size={14} className="text-blue-400 flex-shrink-0" />
        <span>{ist}</span>
        {nextDayIST && (
          <span className="text-[10px] font-semibold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">
            +1 day
          </span>
        )}
      </div>
    </div>
  )
}

export function AppointmentTab({ leadId, userId, userRole, zipCode }: AppointmentTabProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [manualTz, setManualTz] = useState(US_TIMEZONES[0].tz) // fallback when no zip
  const [form, setForm] = useState({
    call_date: '',
    outcome_notes: '',
    appointment_datetime: '',
    zoom_link: '',
    client_requirements: '',
  })
  const supabase = createClient()

  const tzFromZip = useMemo(() => zipCode ? getTimezoneFromZip(zipCode) : null, [zipCode])
  const selectedTz = tzFromZip?.tz ?? manualTz
  const tzInfo = tzFromZip ?? US_TIMEZONES.find(t => t.tz === manualTz) ?? US_TIMEZONES[0]

  // Live dual-time preview while agent is typing
  const livePreview = useMemo(() => {
    if (!form.appointment_datetime || !selectedTz) return null
    const utcISO = localToUTC(form.appointment_datetime, selectedTz)
    if (!utcISO) return null
    return formatDualTime(utcISO, selectedTz, tzInfo.abbr)
  }, [form.appointment_datetime, selectedTz, tzInfo.abbr])

  useEffect(() => { fetchAppointments() }, [leadId])

  async function fetchAppointments() {
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setAppointments(data)
  }

  async function handleSave() {
    setLoading(true)

    // Convert the entered US local time to UTC before storing
    const appointmentDatetimeUTC = form.appointment_datetime && selectedTz
      ? localToUTC(form.appointment_datetime, selectedTz)
      : form.appointment_datetime || null

    await supabase.from('appointments').insert({
      lead_id: leadId,
      created_by: userId,
      call_date: form.call_date || null,
      outcome_notes: form.outcome_notes || null,
      appointment_datetime: appointmentDatetimeUTC,
      zoom_link: form.zoom_link || null,
      client_requirements: form.client_requirements || null,
      timezone: form.appointment_datetime ? selectedTz : null,
    })

    // Move lead to Demo Scheduled so it appears in developer queue
    await supabase
      .from('leads')
      .update({ status: 'Demo Scheduled', updated_at: new Date().toISOString() })
      .eq('id', leadId)

    // Notify all developers
    const { data: devs } = await supabase.from('profiles').select('id').eq('role', 'developer')
    if (devs && devs.length > 0) {
      await supabase.from('notifications').insert(
        devs.map(d => ({
          user_id: d.id,
          lead_id: leadId,
          title: 'New Demo Scheduled',
          message: 'A new demo has been scheduled. Check the Developer Queue.',
          type: 'info',
        }))
      )
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Scheduled',
      details: form.appointment_datetime
        ? `Appointment scheduled — ${livePreview?.us ?? ''}`
        : 'Appointment logged — demo queued for developers',
    })

    setForm({ call_date: '', outcome_notes: '', appointment_datetime: '', zoom_link: '', client_requirements: '' })
    setShowModal(false)
    setLoading(false)
    fetchAppointments()
  }

  const canEdit = userRole === 'admin' || userRole === 'sales_agent'

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Log Call / Appointment
          </Button>
        </div>
      )}

      {appointments.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No appointments logged yet.</div>
      ) : (
        <div className="space-y-3">
          {appointments.map((apt) => (
            <div key={apt.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{formatDate(apt.created_at)}</span>
              </div>

              {apt.call_date && (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Calendar size={14} className="text-orange-400" />
                  Call Date: {formatDate(apt.call_date)}
                </div>
              )}

              {apt.appointment_datetime && (
                <DualTimeDisplay isoStr={apt.appointment_datetime} timezone={apt.timezone} />
              )}

              {apt.zoom_link && (
                <a href={apt.zoom_link} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                  <Video size={14} /> Zoom Link
                </a>
              )}

              {apt.outcome_notes && (
                <div className="flex gap-2 text-sm text-slate-400 bg-slate-700/50 rounded-lg p-3">
                  <FileText size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />
                  <p>{apt.outcome_notes}</p>
                </div>
              )}

              {apt.client_requirements && (
                <div className="flex gap-2 text-sm text-slate-300 bg-orange-900/20 border border-orange-800/40 rounded-lg p-3">
                  <ClipboardList size={14} className="text-orange-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-orange-400 font-medium mb-1">Client Requirements</p>
                    <p className="text-sm text-slate-300">{apt.client_requirements}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Log Call / Appointment">
        <div className="space-y-4">
          <Input label="Call Date" type="date" value={form.call_date}
            onChange={(e) => setForm((f) => ({ ...f, call_date: e.target.value }))} />

          <TextArea label="Outcome / Notes" value={form.outcome_notes} rows={3}
            onChange={(e) => setForm((f) => ({ ...f, outcome_notes: e.target.value }))}
            placeholder="What happened on this call?" />

          {/* Timezone — auto from zip or manual dropdown */}
          {tzFromZip ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5">
              <Info size={12} className="text-orange-400 flex-shrink-0" />
              <span>
                Timezone: <span className="text-slate-200 font-medium">{tzFromZip.label}</span>
                {' '}— auto-detected from ZIP <span className="font-mono">{zipCode}</span>
              </span>
            </div>
          ) : (
            <Select
              label="Client US Timezone"
              value={manualTz}
              options={US_TIMEZONES.map(t => ({ value: t.tz, label: t.label }))}
              onChange={(e) => setManualTz(e.target.value)}
            />
          )}

          {/* Appointment datetime in US time */}
          <div className="space-y-2">
            <Input
              label={`Demo Appointment (${tzInfo.abbr} — US client time)`}
              type="datetime-local"
              value={form.appointment_datetime}
              onChange={(e) => setForm((f) => ({ ...f, appointment_datetime: e.target.value }))}
            />

            {/* Live dual-time preview */}
            {livePreview && (
              <div className="bg-slate-800 border border-orange-800/40 rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Time Preview
                </p>
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <Globe size={13} className="text-orange-400 flex-shrink-0" />
                  {livePreview.us}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <MapPin size={13} className="text-blue-400 flex-shrink-0" />
                  {livePreview.ist}
                  {livePreview.nextDayIST && (
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">
                      +1 day
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <Input label="Zoom Link" type="url" placeholder="https://zoom.us/j/..." value={form.zoom_link}
            onChange={(e) => setForm((f) => ({ ...f, zoom_link: e.target.value }))} />

          <TextArea
            label="Client Requirements"
            value={form.client_requirements}
            rows={4}
            onChange={(e) => setForm((f) => ({ ...f, client_requirements: e.target.value }))}
            placeholder="What does the client need? Website redesign, SEO, GMB optimisation…"
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
