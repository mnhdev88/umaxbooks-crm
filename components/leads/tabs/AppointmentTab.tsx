'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Appointment } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { LogCallModal } from '@/components/leads/LogCallModal'
import { CallCard } from '@/components/voice/CallCard'
import { useLeadCalls } from '@/components/voice/useLeadCalls'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { US_TIMEZONES, getTimezoneFromZip, localToUTC, formatDualTime } from '@/lib/timezone'
import { toast } from 'sonner'
import { Phone, Calendar, Video, FileText, ClipboardList, Globe, MapPin, Info, Clock, CheckCircle2, Search, X } from 'lucide-react'

interface AppointmentTabProps {
  leadId: string
  userId: string
  userRole: string
  zipCode?: string
}

/**
 * The tab used to stack every record type in one column, which read as an endless
 * single line once a lead had any call history. Each source now gets its own
 * sub-tab; the filters below the pills apply to whichever one is open, and the
 * pill counts reflect them so a search shows you which sub-tab holds the match.
 */
const SUB_TABS = [
  { id: 'calls',        label: 'Call History' },
  { id: 'callbacks',    label: 'Callbacks' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'logged',       label: 'Logged Calls' },
] as const

type SubTabId = typeof SUB_TABS[number]['id']

const SUB_TAB_STORAGE_KEY = 'lead-calls-subtab'
const PAGE_SIZE = 10

/** Lowercased haystack for the search box — undefined/null fields drop out. */
function haystack(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/** True when `iso` sits inside the (inclusive) from/to day range; an empty bound is open. */
function inDateRange(iso: string | null | undefined, from: string, to: string) {
  if (!from && !to) return true
  if (!iso) return false
  const day = new Date(iso).toLocaleDateString('en-CA')
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

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

function AppointmentCard({ apt }: { apt: Appointment }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{formatDate(apt.created_at)}</span>
        {/* Badge: call only vs demo */}
        {apt.appointment_datetime ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-800/50">
            Demo Appointment
          </span>
        ) : (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600">
            Call
          </span>
        )}
      </div>

      {apt.call_date && (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Phone size={14} className="text-orange-400" />
          Call Date: {formatDate(apt.call_date)}
        </div>
      )}

      {apt.appointment_datetime && (
        <DualTimeDisplay isoStr={apt.appointment_datetime} timezone={apt.timezone} />
      )}

      {apt.zoom_link && (
        <a href={apt.zoom_link} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
          <Video size={14} /> Zoom / Meet Link
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
  )
}

function CallbackCard({ f }: { f: any }) {
  const isPending = f.status === 'pending'
  const ist = new Date(f.scheduled_at).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const isOverdue = isPending && new Date(f.scheduled_at) < new Date()
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
      isPending
        ? isOverdue
          ? 'bg-red-900/20 border-red-700/40'
          : 'bg-slate-800 border-slate-700'
        : 'bg-slate-900/40 border-slate-800 opacity-60'
    }`}>
      <div className="mt-0.5 flex-shrink-0">
        {isPending
          ? <Clock size={14} className={isOverdue ? 'text-red-400' : 'text-orange-400'} />
          : <CheckCircle2 size={14} className="text-green-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isOverdue ? 'text-red-300' : isPending ? 'text-slate-200' : 'text-slate-500'}`}>
            {ist} IST
          </span>
          {isOverdue && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-700/50">
              Overdue
            </span>
          )}
          {!isPending && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/40">
              Completed
            </span>
          )}
        </div>
        {f.notes && <p className="text-xs text-slate-400 mt-0.5">{f.notes}</p>}
        {f.author?.full_name && (
          <p className="text-[11px] text-slate-600 mt-0.5">Set by {f.author.full_name}</p>
        )}
      </div>
    </div>
  )
}

export function AppointmentTab({ leadId, userId, userRole, zipCode }: AppointmentTabProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [followUps, setFollowUps] = useState<any[]>([])
  const [showCallModal, setShowCallModal] = useState(false)
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [manualTz, setManualTz] = useState(US_TIMEZONES[0].tz)

  const [subTab, setSubTab] = useState<SubTabId>('calls')
  const [pickedSubTab, setPickedSubTab] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const [demoForm, setDemoForm] = useState({
    appointment_date: '',
    appointment_time: '',
    zoom_link: '',
    client_requirements: '',
  })

  const timeSlots = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2)
    const m = i % 2 === 0 ? '00' : '30'
    const label = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m} ${h < 12 ? 'AM' : 'PM'}`
    const value = `${String(h).padStart(2, '0')}:${m}`
    return { value, label }
  })

  // Human calls (dialer + inbound). AI calls stay on the AI Calls tab.
  const { calls: voiceCalls, loading: loadingCalls } = useLeadCalls(leadId, 'human')

  const supabase = createClient()
  const tzFromZip = useMemo(() => zipCode ? getTimezoneFromZip(zipCode) : null, [zipCode])
  const selectedTz = tzFromZip?.tz ?? manualTz
  const tzInfo = tzFromZip ?? US_TIMEZONES.find(t => t.tz === manualTz) ?? US_TIMEZONES[0]

  const appointmentDatetime = demoForm.appointment_date && demoForm.appointment_time
    ? `${demoForm.appointment_date}T${demoForm.appointment_time}`
    : ''

  const livePreview = useMemo(() => {
    if (!appointmentDatetime || !selectedTz) return null
    const utcISO = localToUTC(appointmentDatetime, selectedTz)
    if (!utcISO) return null
    return formatDualTime(utcISO, selectedTz, tzInfo.abbr)
  }, [appointmentDatetime, selectedTz, tzInfo.abbr])

  useEffect(() => { fetchAppointments(); fetchFollowUps() }, [leadId])

  // The remembered sub-tab is read after mount — the server pass has no
  // localStorage, and reading it at render would hydrate the wrong pill.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SUB_TAB_STORAGE_KEY) as SubTabId | null
      if (saved && SUB_TABS.some(t => t.id === saved)) {
        setSubTab(saved)
        setPickedSubTab(true)
      }
    } catch { /* private mode — fall back to the first non-empty sub-tab */ }
  }, [])

  // Paging restarts whenever the list underneath it changes.
  useEffect(() => { setVisible(PAGE_SIZE) }, [subTab, search, dateFrom, dateTo])

  async function fetchAppointments() {
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setAppointments(data)
  }

  async function fetchFollowUps() {
    const { data } = await supabase
      .from('follow_ups')
      .select('*, author:profiles(full_name)')
      .eq('lead_id', leadId)
      .order('scheduled_at', { ascending: true })
    if (data) setFollowUps(data)
  }

  async function handleSaveDemo() {
    setLoadingDemo(true)

    const appointmentDatetimeUTC = appointmentDatetime && selectedTz
      ? localToUTC(appointmentDatetime, selectedTz)
      : appointmentDatetime || null

    await supabase.from('appointments').insert({
      lead_id: leadId,
      created_by: userId,
      appointment_datetime: appointmentDatetimeUTC,
      zoom_link: demoForm.zoom_link || null,
      client_requirements: demoForm.client_requirements || null,
      timezone: appointmentDatetime ? selectedTz : null,
    })

    const demoStatusRes = await fetch('/api/leads/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, status: 'Demo Scheduled' }),
    })
    if (!demoStatusRes.ok) {
      const err = await demoStatusRes.json().catch(() => ({}))
      toast.error(`Failed to update lead status: ${err.error || demoStatusRes.statusText}`)
    }

    // Notify developers
    const { data: devs } = await supabase.from('profiles').select('id').eq('role', 'developer')
    if (devs && devs.length > 0) {
      await supabase.from('notifications').insert(
        devs.map((d: any) => ({
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
      details: appointmentDatetime
        ? `Demo booked — ${livePreview?.us ?? ''}`
        : 'Demo appointment logged',
    })

    setDemoForm({ appointment_date: '', appointment_time: '', zoom_link: '', client_requirements: '' })
    setShowDemoModal(false)
    setLoadingDemo(false)
    fetchAppointments()
    // Land on the sub-tab that now holds the new row.
    selectSubTab('appointments')
  }

  function selectSubTab(id: SubTabId) {
    setSubTab(id)
    setPickedSubTab(true)
    try { localStorage.setItem(SUB_TAB_STORAGE_KEY, id) } catch { /* ignore */ }
  }

  const canEdit = userRole === 'admin' || userRole === 'sales_agent' || userRole === 'sales_manager'
  const q = search.trim().toLowerCase()
  const filtersOn = !!q || !!dateFrom || !!dateTo

  // `appointments` holds both booked demos (they carry a datetime) and the manual
  // wrap-up rows the Log Call modal writes, which belong on different sub-tabs.
  const demoRows = useMemo(
    () => appointments.filter(a => !!a.appointment_datetime),
    [appointments]
  )
  const loggedRows = useMemo(
    () => appointments.filter(a => !a.appointment_datetime),
    [appointments]
  )

  const filteredCalls = useMemo(() => voiceCalls.filter((c: any) => {
    if (!inDateRange(c.created_at, dateFrom, dateTo)) return false
    if (!q) return true
    return haystack(
      c.from_number, c.to_number, c.summary, c.notes, c.objection,
      c.status, c.direction, c.inbound_outcome, c.answered_by,
      c.agent?.full_name, c.owner?.full_name,
    ).includes(q)
  }), [voiceCalls, q, dateFrom, dateTo])

  // Pending callbacks lead — soonest (so overdue) first, because that is the work
  // still owed. Everything already handled trails behind, newest first.
  const filteredCallbacks = useMemo(() => followUps
    .filter((f: any) => {
      if (!inDateRange(f.scheduled_at, dateFrom, dateTo)) return false
      if (!q) return true
      return haystack(f.notes, f.status, f.author?.full_name).includes(q)
    })
    .slice()
    .sort((a: any, b: any) => {
      const aPending = a.status === 'pending'
      const bPending = b.status === 'pending'
      if (aPending !== bPending) return aPending ? -1 : 1
      const at = new Date(a.scheduled_at).getTime()
      const bt = new Date(b.scheduled_at).getTime()
      return aPending ? at - bt : bt - at
    }),
  [followUps, q, dateFrom, dateTo])

  function filterAppointments(rows: Appointment[], dateOf: (a: Appointment) => string | null | undefined) {
    return rows.filter((a) => {
      if (!inDateRange(dateOf(a), dateFrom, dateTo)) return false
      if (!q) return true
      return haystack(a.outcome_notes, a.client_requirements, a.zoom_link).includes(q)
    })
  }

  const filteredDemos = useMemo(
    () => filterAppointments(demoRows, a => a.appointment_datetime),
    [demoRows, q, dateFrom, dateTo]
  )
  const filteredLogged = useMemo(
    () => filterAppointments(loggedRows, a => a.call_date ?? a.created_at),
    [loggedRows, q, dateFrom, dateTo]
  )

  const counts: Record<SubTabId, number> = {
    calls: filteredCalls.length,
    callbacks: filteredCallbacks.length,
    appointments: filteredDemos.length,
    logged: filteredLogged.length,
  }

  // Until the rep picks a sub-tab themselves, open the first one that has rows so
  // the tab never lands on an empty list when there is history to show.
  const effectiveSubTab: SubTabId = pickedSubTab
    ? subTab
    : (SUB_TABS.find(t => counts[t.id] > 0)?.id ?? 'calls')

  const totalRows = voiceCalls.length + followUps.length + appointments.length
  const shownCount = counts[effectiveSubTab]

  function renderList() {
    if (effectiveSubTab === 'calls') {
      return filteredCalls.slice(0, visible).map((call) => <CallCard key={call.id} call={call} />)
    }
    if (effectiveSubTab === 'callbacks') {
      return filteredCallbacks.slice(0, visible).map((f) => <CallbackCard key={f.id} f={f} />)
    }
    const rows = effectiveSubTab === 'appointments' ? filteredDemos : filteredLogged
    return rows.slice(0, visible).map((apt) => <AppointmentCard key={apt.id} apt={apt} />)
  }

  const emptyCopy: Record<SubTabId, string> = {
    calls: 'No dialer or inbound calls for this lead yet.',
    callbacks: 'No callbacks scheduled.',
    appointments: 'No demo appointments booked yet.',
    logged: 'No calls logged by hand yet.',
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowCallModal(true)}>
            <Phone size={14} /> Log Call
          </Button>
          <Button size="sm" onClick={() => setShowDemoModal(true)}>
            <Calendar size={14} /> Book Demo
          </Button>
        </div>
      )}

      {/* ── Sub-tabs ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((t) => {
          const active = effectiveSubTab === t.id
          const empty = counts[t.id] === 0
          return (
            <button
              key={t.id}
              onClick={() => selectSubTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                  : empty
                    ? 'bg-slate-900/40 border-slate-800 text-slate-600 hover:text-slate-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              )}
            >
              {t.label}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                active ? 'bg-orange-500/25 text-orange-300' : 'bg-slate-700/60 text-slate-400'
              )}>
                {counts[t.id]}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Filters (apply to the open sub-tab) ───────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none z-10" />
          <Input
            placeholder="Search notes, numbers, agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Input
          type="date"
          aria-label="From date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-[150px]"
        />
        <Input
          type="date"
          aria-label="To date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-[150px]"
        />
        {filtersOn && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
          >
            <X size={13} /> Clear
          </Button>
        )}
      </div>

      {/* ── List ──────────────────────────────────────────────── */}
      {loadingCalls && totalRows === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading call history…</div>
      ) : shownCount === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {filtersOn ? 'Nothing matches these filters.' : emptyCopy[effectiveSubTab]}
        </div>
      ) : (
        <div className="space-y-3">
          {renderList()}
          {shownCount > visible && (
            <div className="pt-1 text-center">
              <Button size="sm" variant="ghost" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                Show more ({shownCount - visible} left)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Log Call Modal (shared with the dialer wrap-up) ────────── */}
      <LogCallModal
        open={showCallModal}
        onClose={() => setShowCallModal(false)}
        leadId={leadId}
        userId={userId}
        zipCode={zipCode}
        onSaved={() => { fetchAppointments(); fetchFollowUps() }}
      />

      {/* ── Book Demo Modal ────────────────────────────────────────── */}
      <Modal open={showDemoModal} onClose={() => setShowDemoModal(false)} title="Book Demo Appointment">
        <div className="space-y-4">

          {/* Timezone */}
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

          {/* Appointment datetime */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Demo Date &amp; Time ({tzInfo.abbr} — US client time)
            </p>
            <div className="flex gap-2">
              <Input
                type="date"
                value={demoForm.appointment_date}
                min={new Date().toLocaleDateString('en-CA')}
                onChange={(e) => setDemoForm(f => ({ ...f, appointment_date: e.target.value }))}
                className="flex-1"
              />
              <Select
                options={timeSlots}
                placeholder="-- Time --"
                value={demoForm.appointment_time}
                onChange={(e) => setDemoForm(f => ({ ...f, appointment_time: e.target.value }))}
              />
            </div>

            {livePreview && (
              <div className="bg-slate-800 border border-orange-800/40 rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Time Preview</p>
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

          <Input
            label="Zoom Link / Google Meet Link"
            type="url"
            placeholder="https://zoom.us/j/... or https://meet.google.com/..."
            value={demoForm.zoom_link}
            onChange={(e) => setDemoForm(f => ({ ...f, zoom_link: e.target.value }))}
          />

          <TextArea
            label="Client Requirements"
            value={demoForm.client_requirements}
            rows={3}
            onChange={(e) => setDemoForm(f => ({ ...f, client_requirements: e.target.value }))}
            placeholder="What does the client need? Website redesign, SEO, GMB…"
          />

          <p className="text-xs text-slate-500">Saving will move the lead status to <span className="text-blue-400 font-medium">Demo Scheduled</span> and notify developers.</p>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={() => setShowDemoModal(false)}>Cancel</Button>
            <Button onClick={handleSaveDemo} loading={loadingDemo}>
              <Calendar size={13} /> Book Demo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
