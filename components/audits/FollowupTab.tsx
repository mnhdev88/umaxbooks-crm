'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FollowUpStep } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import {
  Check, Phone, Mail, MessageCircle, Video, Pause, Play,
  ChevronRight, Clock, AlertCircle, ExternalLink,
} from 'lucide-react'

// ── Step definitions ──────────────────────────────────────────────
const STEP_DEFS = [
  {
    number: 1,
    title: 'Introduction Call',
    channels: ['call'],
    desc: 'First contact. Introduce the free audit offer. Note client\'s current situation, website age, openness to change.',
    tip: null,
  },
  {
    number: 2,
    title: 'Send Audit Summary',
    channels: ['email', 'whatsapp'],
    desc: 'Send summary audit PDF on email + WhatsApp. Mention 3 quick wins from the audit to create urgency.',
    tip: null,
  },
  {
    number: 3,
    title: 'Follow-up Call + Schedule Meeting',
    channels: ['call', 'zoom'],
    desc: 'Call to discuss the audit findings. Goal: schedule a Zoom demo. If no answer, send a WhatsApp reminder.',
    tip: null,
  },
  {
    number: 4,
    title: 'Zoom Demo',
    channels: ['zoom'],
    desc: 'Show demo website, walk through audit findings, present value. No payment obligation. If interested — collect revision info.',
    tip: 'Auto-scheduled 2 days after Step 3 is marked done. Agent can override the date.',
  },
  {
    number: 5,
    title: 'Close / Final Follow-up',
    channels: ['call', 'whatsapp'],
    desc: 'Post-demo follow-up. Collect token payment or authorization. If client declines, mark as Lost with reason.',
    tip: 'If no response after Step 5 → lead auto-tagged for monthly re-nurture campaign.',
  },
]

const OUTCOMES = [
  'Connected — meeting scheduled',
  'Connected — follow up needed',
  'No answer — left voicemail',
  'No answer — WhatsApp sent',
  'Sent audit PDF on WhatsApp',
  'Sent audit PDF on email',
  'Zoom meeting booked',
  'Demo done — interested',
  'Demo done — needs time',
  'Not interested',
]

const CH_ICON: Record<string, React.ReactNode> = {
  call:      <Phone size={10} />,
  email:     <Mail size={10} />,
  whatsapp:  <MessageCircle size={10} />,
  zoom:      <Video size={10} />,
}

const CH_CLS: Record<string, string> = {
  call:     'bg-teal-900/40 text-teal-400 border border-teal-800/40',
  email:    'bg-blue-900/40 text-blue-400 border border-blue-800/40',
  whatsapp: 'bg-green-900/40 text-green-400 border border-green-800/40',
  zoom:     'bg-purple-900/40 text-purple-400 border border-purple-800/40',
}

interface Props {
  leadId: string
  companyName: string
  userId: string
  userRole: string
}

export function FollowupTab({ leadId, companyName, userId, userRole }: Props) {
  const supabase = createClient()
  const [steps, setSteps] = useState<FollowUpStep[]>([])
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)

  // Form state for active step
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [zoomLink, setZoomLink] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchSteps() }, [leadId])

  async function fetchSteps() {
    setLoading(true)
    const { data } = await supabase
      .from('follow_up_steps')
      .select('*')
      .eq('lead_id', leadId)
      .order('step_number')
    if (!data || data.length === 0) {
      await initSteps()
    } else {
      setSteps(data as FollowUpStep[])
    }
    setLoading(false)
  }

  async function initSteps() {
    const rows = STEP_DEFS.map(def => ({
      lead_id:     leadId,
      step_number: def.number,
      status:      def.number === 1 ? 'active' : 'pending',
      created_by:  userId,
    }))
    const { data } = await supabase.from('follow_up_steps').insert(rows).select()
    if (data) {
      setSteps(data as FollowUpStep[])
      // Update lead follow_up_step
      await supabase.from('leads').update({ follow_up_step: 1 }).eq('id', leadId)
    }
  }

  async function markDone() {
    const active = steps.find(s => s.status === 'active')
    if (!active) return
    setSaving(true)

    await supabase.from('follow_up_steps').update({
      status:       'done',
      outcome:      outcome || null,
      notes:        notes   || null,
      scheduled_at: scheduledAt || null,
      zoom_link:    zoomLink    || null,
      completed_at: new Date().toISOString(),
    }).eq('id', active.id)

    const nextStep = steps.find(s => s.step_number === active.step_number + 1)
    if (nextStep) {
      await supabase.from('follow_up_steps').update({ status: 'active' }).eq('id', nextStep.id)
      await supabase.from('leads').update({ follow_up_step: nextStep.step_number }).eq('id', leadId)
    } else {
      // All steps done
      await supabase.from('leads').update({ follow_up_step: 5 }).eq('id', leadId)
    }

    const def = STEP_DEFS[active.step_number - 1]
    await supabase.from('activity_logs').insert({
      lead_id:  leadId,
      user_id:  userId,
      action:   `Follow-up Step ${active.step_number} Complete`,
      details:  `${def.title}${outcome ? ' — ' + outcome : ''}${notes ? '. Notes: ' + notes : ''}`,
    })

    setOutcome(''); setNotes(''); setScheduledAt(''); setZoomLink('')
    fetchSteps()
    setSaving(false)
  }

  async function skipStep() {
    const active = steps.find(s => s.status === 'active')
    if (!active) return
    await supabase.from('follow_up_steps').update({ status: 'skipped' }).eq('id', active.id)
    const nextStep = steps.find(s => s.step_number === active.step_number + 1)
    if (nextStep) {
      await supabase.from('follow_up_steps').update({ status: 'active' }).eq('id', nextStep.id)
      await supabase.from('leads').update({ follow_up_step: nextStep.step_number }).eq('id', leadId)
    }
    fetchSteps()
  }

  async function togglePause() {
    const next = !paused
    setPaused(next)
    await supabase.from('leads').update({ follow_up_paused: next }).eq('id', leadId)
    await supabase.from('activity_logs').insert({
      lead_id: leadId, user_id: userId,
      action:  next ? 'Follow-up Paused' : 'Follow-up Resumed',
      details: `Follow-up sequence ${next ? 'paused' : 'resumed'} for ${companyName}`,
    })
  }

  const activeStep = steps.find(s => s.status === 'active')
  const doneCount  = steps.filter(s => s.status === 'done').length

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <svg className="animate-spin h-5 w-5 text-orange-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100">5-Step Follow-up Sequence</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {companyName} · {activeStep ? `Currently on Step ${activeStep.step_number}` : doneCount === 5 ? 'All steps complete' : 'Sequence not started'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={togglePause}>
            {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
          </Button>
          {activeStep && (
            <Button size="sm" onClick={markDone} loading={saving}>
              <Check size={12} /> Mark Step Done
            </Button>
          )}
        </div>
      </div>

      {paused && (
        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-300">
          <Pause size={12} /> Follow-up sequence is paused.
        </div>
      )}

      {/* Timeline */}
      <div>
        {STEP_DEFS.map((def, idx) => {
          const step   = steps.find(s => s.step_number === def.number)
          const status = step?.status || 'pending'
          const isActive  = status === 'active'
          const isDone    = status === 'done'
          const isSkipped = status === 'skipped'
          const isLast = idx === STEP_DEFS.length - 1

          return (
            <div key={def.number} className="flex gap-3">
              {/* Dot + connector */}
              <div className="flex flex-col items-center pt-0.5">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold flex-shrink-0 transition-all',
                  isDone    ? 'bg-green-900/30 border-green-500 text-green-400' :
                  isActive  ? 'bg-orange-900/30 border-orange-500 text-orange-400' :
                  isSkipped ? 'bg-red-900/20 border-red-700/50 text-red-400' :
                              'bg-slate-800 border-slate-600 text-slate-500'
                )}>
                  {isDone ? <Check size={13} /> : isSkipped ? '✕' : def.number}
                </div>
                {!isLast && (
                  <div className={cn('w-0.5 min-h-[20px] flex-1 mt-1',
                    isDone ? 'bg-green-500/40' : 'bg-slate-700'
                  )} />
                )}
              </div>

              {/* Step body */}
              <div className={cn(
                'flex-1 rounded-xl border p-3.5 mb-3',
                isActive  ? 'border-orange-500/30 bg-orange-900/10' :
                isDone    ? 'border-green-800/20 bg-green-900/5' :
                isSkipped ? 'border-red-800/20 bg-slate-800/20 opacity-60' :
                            'border-slate-700/60 bg-slate-800/20'
              )}>
                {/* Title row */}
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <p className={cn('text-sm font-semibold', isActive ? 'text-orange-300' : isDone ? 'text-slate-200' : 'text-slate-400')}>
                    Step {def.number} — {def.title}
                  </p>
                  {def.channels.map(ch => (
                    <span key={ch} className={cn('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium capitalize', CH_CLS[ch])}>
                      {CH_ICON[ch]} {ch}
                    </span>
                  ))}
                  <span className={cn(
                    'ml-auto text-xs font-medium',
                    isDone    ? 'text-green-400' :
                    isActive  ? 'text-orange-400' :
                    isSkipped ? 'text-red-400' : 'text-slate-600'
                  )}>
                    {isDone    ? `Done · ${step?.completed_at ? new Date(step.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}` :
                     isActive  ? 'Due now' :
                     isSkipped ? 'Skipped' : 'Pending'}
                  </span>
                </div>

                <p className="text-xs text-slate-500 mb-2 leading-relaxed">{def.desc}</p>

                {/* Done: show outcome + notes */}
                {isDone && (step?.outcome || step?.notes) && (
                  <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-xs space-y-1">
                    {step.outcome && <p className="text-slate-300"><span className="text-slate-500">Outcome:</span> {step.outcome}</p>}
                    {step.notes   && <p className="text-slate-400 italic">{step.notes}</p>}
                    {step.zoom_link && (
                      <a href={step.zoom_link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-purple-400 hover:text-purple-300">
                        <Video size={10} /> Zoom link <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                )}

                {/* Tip for pending steps */}
                {def.tip && !isDone && !isActive && (
                  <p className="text-xs text-amber-500/70 mt-1">
                    <AlertCircle size={10} className="inline mr-1" />
                    {def.tip}
                  </p>
                )}

                {/* Active step: logging form */}
                {isActive && !paused && (
                  <div className="mt-3 pt-3 border-t border-orange-500/20 space-y-2.5">
                    <p className="text-xs text-slate-500 font-medium">Log this interaction:</p>

                    {/* Outcome select + scheduled datetime */}
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={outcome}
                        onChange={e => setOutcome(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer"
                      >
                        <option value="">Call outcome…</option>
                        {OUTCOMES.map(o => <option key={o}>{o}</option>)}
                      </select>
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={e => setScheduledAt(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-orange-500 [color-scheme:dark]"
                      />
                    </div>

                    {/* Zoom link (for steps with zoom) */}
                    {def.channels.includes('zoom') && (
                      <input
                        type="url"
                        value={zoomLink}
                        onChange={e => setZoomLink(e.target.value)}
                        placeholder="Zoom / Meet link (optional)"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
                      />
                    )}

                    {/* Notes */}
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder={`Notes — what did the client say?`}
                      rows={2}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                    />

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={markDone} loading={saving} className="text-xs py-1.5">
                        <Check size={12} /> Log & Move to Step {def.number < 5 ? def.number + 1 : '— Complete'}
                      </Button>
                      {def.channels.includes('zoom') && (
                        <Button size="sm" variant="ghost" className="text-xs py-1.5 text-purple-400 border-purple-800/50 hover:bg-purple-900/20">
                          <Video size={12} /> Book Zoom Meeting
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-xs py-1.5 text-slate-500" onClick={skipStep}>
                        Skip Step
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* All done state */}
      {doneCount === 5 && (
        <div className="bg-green-900/20 border border-green-800/30 rounded-xl p-4 text-center">
          <Check size={20} className="text-green-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-green-300">All 5 steps complete!</p>
          <p className="text-xs text-slate-500 mt-1">The full follow-up sequence for {companyName} is done.</p>
        </div>
      )}
    </div>
  )
}
