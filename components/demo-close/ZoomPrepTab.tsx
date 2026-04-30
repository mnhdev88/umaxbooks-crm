'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PresentationMode } from './PresentationMode'
import { Button } from '@/components/ui/Button'
import { CheckSquare, Square, CheckCircle, ExternalLink, Video, MonitorPlay } from 'lucide-react'
import { cn } from '@/lib/utils'

const PREP_ITEMS = [
  { key: 'demo_tested',       label: 'Open demo URL in browser – test it loads on mobile and desktop' },
  { key: 'before_after_read', label: 'Read the Before/After tab – know the top 3 numbers by heart' },
  { key: 'agent_notes_read',  label: 'Review agent notes and client\'s specific pain points' },
  { key: 'pdf_ready',         label: 'Have audit summary PDF ready to share on screen' },
  { key: 'speed_checked',     label: 'Check internet speed – minimum 10 Mbps for clean Zoom screen share' },
  { key: 'pricing_ready',     label: 'Know the pricing and token amount – have payment link ready' },
  { key: 'objections_read',   label: 'Read the Objection Handler tab – prepare for "let me think about it"' },
]

interface ZoomPrepTabProps {
  lead: any
  userId: string
  closing: any
  comparison: any
  metrics: any[]
  onChecklistSave: (checklist: Record<string, boolean>) => void
}

export function ZoomPrepTab({ lead, userId, closing, comparison, metrics, onChecklistSave }: ZoomPrepTabProps) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>(closing?.prep_checklist || {})
  const [presOpen, setPresOpen] = useState(false)

  useEffect(() => {
    setChecklist(closing?.prep_checklist || {})
  }, [closing?.id])

  function toggle(key: string) {
    const updated = { ...checklist, [key]: !checklist[key] }
    setChecklist(updated)
    onChecklistSave(updated)
  }

  const checkedCount = PREP_ITEMS.filter(p => checklist[p.key]).length
  const approval = lead?.demo_approvals?.[0]
  const appointment = lead?.appointments?.[0]
  const demoUrl = lead?.demos?.[0]?.temp_url

  const meetingDateTime = appointment?.appointment_datetime
    ? new Date(appointment.appointment_datetime)
    : null

  return (
    <>
      <PresentationMode
        isOpen={presOpen}
        onClose={() => setPresOpen(false)}
        lead={lead}
        comparison={comparison}
        metrics={metrics}
        appointment={appointment}
      />

      <div className="space-y-5">

        {/* Approved banner */}
        {approval?.status === 'approved' ? (
          <div className="flex items-start gap-3 bg-green-900/15 border border-green-700/30 rounded-xl px-4 py-3.5">
            <CheckCircle size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-300 mb-0.5">
                Demo approved{approval.auditor?.full_name ? ` by ${approval.auditor.full_name}` : ''}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                The demo site has been reviewed and signed off. You're cleared to present this to the client. Use presentation mode below for a clean, client-facing walkthrough.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 bg-amber-900/15 border border-amber-700/30 rounded-xl px-4 py-3.5">
            <CheckCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300 mb-0.5">Demo pending approval</p>
              <p className="text-xs text-slate-400">The demo has not yet been approved. Check with the auditor before presenting to the client.</p>
            </div>
          </div>
        )}

        {/* Meeting card */}
        {(meetingDateTime || demoUrl || appointment?.zoom_link) && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                {meetingDateTime ? (
                  <>
                    <p className="text-2xl font-bold text-teal-400 tracking-tight">
                      {meetingDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm text-slate-400 mt-0.5">
                      {meetingDateTime.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">No meeting scheduled yet</p>
                )}
              </div>
              {appointment?.zoom_link && (
                <span className="text-xs px-2.5 py-1 bg-purple-900/30 text-purple-300 border border-purple-700/30 rounded-full">Zoom Confirmed</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs mb-4">
              <div><p className="text-slate-500 mb-0.5 uppercase tracking-wider text-[10px]">Client</p><p className="text-slate-200 font-medium">{lead.name}</p></div>
              <div><p className="text-slate-500 mb-0.5 uppercase tracking-wider text-[10px]">Company</p><p className="text-slate-200 font-medium">{lead.company_name}</p></div>
              {demoUrl && (
                <div><p className="text-slate-500 mb-0.5 uppercase tracking-wider text-[10px]">Demo URL</p>
                  <a href={demoUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    {demoUrl.replace(/^https?:\/\//,'').substring(0, 30)}… <ExternalLink size={10} />
                  </a>
                </div>
              )}
              {appointment?.zoom_link && (
                <div><p className="text-slate-500 mb-0.5 uppercase tracking-wider text-[10px]">Zoom link</p>
                  <a href={appointment.zoom_link} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    Open Zoom <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
            {appointment?.zoom_link && (
              <a href={appointment.zoom_link} target="_blank" rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 py-3 bg-purple-900/20 hover:bg-purple-900/30 border border-purple-700/30 rounded-lg text-purple-300 text-sm font-semibold transition-colors">
                <Video size={15} /> Join Zoom Meeting
              </a>
            )}
            {appointment?.outcome_notes && (
              <p className="text-xs text-slate-500 mt-3 italic">"{appointment.outcome_notes}"</p>
            )}
          </div>
        )}

        {/* Pre-call checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pre-call Checklist</p>
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
              checkedCount === PREP_ITEMS.length ? 'bg-green-900/30 text-green-300' : 'bg-slate-800 text-slate-400')}>
              {checkedCount}/{PREP_ITEMS.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {PREP_ITEMS.map(item => {
              const checked = checklist[item.key] || false
              return (
                <button
                  key={item.key}
                  onClick={() => toggle(item.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-slate-800"
                >
                  {checked
                    ? <CheckSquare size={15} className="text-green-400 flex-shrink-0" />
                    : <Square size={15} className="text-slate-600 flex-shrink-0" />}
                  <span className={cn('text-sm leading-snug', checked ? 'text-slate-400 line-through' : 'text-slate-300')}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Launch presentation */}
        <div className="bg-gradient-to-br from-orange-900/15 to-orange-900/5 border border-orange-700/25 rounded-xl p-5 text-center">
          <p className="text-sm font-semibold text-slate-100 mb-1">Ready to present?</p>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Launch full-screen presentation mode. Walk the client through 4 clean slides — intro, before/after, numbers, impact + demo URL. No CRM visible to client.
          </p>
          <Button onClick={() => setPresOpen(true)} className="px-6">
            <MonitorPlay size={15} /> Launch Presentation Mode
          </Button>
        </div>
      </div>
    </>
  )
}
