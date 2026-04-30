'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DealClosing } from '@/types'
import { Button } from '@/components/ui/Button'
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

const SERVICES = [
  'New website design', 'Mobile optimisation', 'SEO setup (on-page)',
  'Google My Business optimisation', 'WhatsApp chat widget', 'Contact form setup',
  'Speed optimisation', 'Schema markup',
]

const PAYMENT_TYPES = ['Token amount', 'Full payment upfront', 'Authorization only (no payment yet)']
const PAYMENT_METHODS = ['UPI', 'Bank Transfer', 'Cash', 'Card', 'Cheque']
const LOST_REASONS = [
  'Too expensive', 'Not the decision maker', 'Happy with current website',
  'Using another vendor', 'Timing not right', 'No response / ghosted', 'Other',
]
const RENURTURE_ACTIONS = ['Call back', 'Send follow-up email', 'WhatsApp message']

interface CloseDealTabProps {
  leadId: string
  userId: string
  closing: DealClosing | null
  onClose: () => void
}

export function CloseDealTab({ leadId, userId, closing, onClose }: CloseDealTabProps) {
  const supabase = createClient()
  const [outcome, setOutcome] = useState<'pending' | 'won' | 'lost'>(closing?.outcome || 'pending')
  const [saving, setSaving] = useState(false)

  // Won form state
  const [paymentType, setPaymentType]         = useState(closing?.payment_type || 'Token amount')
  const [tokenAmount, setTokenAmount]         = useState(closing?.token_amount?.toString() || '')
  const [paymentMethod, setPaymentMethod]     = useState(closing?.payment_method || 'UPI')
  const [transactionId, setTransactionId]     = useState(closing?.transaction_id || '')
  const [services, setServices]               = useState<string[]>(closing?.services || ['New website design', 'Mobile optimisation'])
  const [startDate, setStartDate]             = useState(closing?.start_date || new Date().toISOString().split('T')[0])
  const [endDate, setEndDate]                 = useState(closing?.end_date || '')
  const [clientPhone, setClientPhone]         = useState(closing?.client_phone || '')
  const [clientEmail, setClientEmail]         = useState(closing?.client_email || '')
  const [revisionNotes, setRevisionNotes]     = useState(closing?.revision_notes || '')
  const [closingCallNotes, setClosingCallNotes] = useState(closing?.closing_call_notes || '')

  // Lost form state
  const [lostReason, setLostReason]       = useState(closing?.lost_reason || 'Too expensive')
  const [lostNotes, setLostNotes]         = useState(closing?.lost_notes || '')
  const [reNurtureDate, setReNurtureDate] = useState(closing?.re_nurture_date || '')
  const [reNurtureAction, setReNurtureAction] = useState(closing?.re_nurture_action || 'Call back')

  useEffect(() => {
    if (closing) {
      setOutcome(closing.outcome)
      setPaymentType(closing.payment_type || 'Token amount')
      setTokenAmount(closing.token_amount?.toString() || '')
      setPaymentMethod(closing.payment_method || 'UPI')
      setTransactionId(closing.transaction_id || '')
      setServices(closing.services || ['New website design', 'Mobile optimisation'])
      setStartDate(closing.start_date || new Date().toISOString().split('T')[0])
      setEndDate(closing.end_date || '')
      setClientPhone(closing.client_phone || '')
      setClientEmail(closing.client_email || '')
      setRevisionNotes(closing.revision_notes || '')
      setClosingCallNotes(closing.closing_call_notes || '')
      setLostReason(closing.lost_reason || 'Too expensive')
      setLostNotes(closing.lost_notes || '')
      setReNurtureDate(closing.re_nurture_date || '')
      setReNurtureAction(closing.re_nurture_action || 'Call back')
    }
  }, [closing?.id])

  function toggleService(s: string) {
    setServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function calcDuration() {
    if (!startDate || !endDate) return ''
    const d = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    return d > 0 ? `${d} days` : ''
  }

  async function upsertClosing(data: Partial<DealClosing>) {
    if (closing?.id) {
      const { error } = await supabase.from('deal_closings').update({ ...data, updated_at: new Date().toISOString() }).eq('id', closing.id)
      return error
    } else {
      const { error } = await supabase.from('deal_closings').insert({ lead_id: leadId, ...data })
      return error
    }
  }

  async function confirmClose() {
    setSaving(true)
    const error = await upsertClosing({
      outcome: 'won',
      payment_type: paymentType,
      token_amount: tokenAmount ? parseFloat(tokenAmount) : undefined,
      payment_method: paymentMethod,
      transaction_id: transactionId,
      services,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      duration_days: calcDuration() ? parseInt(calcDuration()) : undefined,
      client_phone: clientPhone,
      client_email: clientEmail,
      revision_notes: revisionNotes,
      closing_call_notes: closingCallNotes,
      closed_by: userId,
      closed_at: new Date().toISOString(),
    } as any)

    if (!error) {
      await supabase.from('leads').update({ status: 'Closed Won', updated_at: new Date().toISOString() }).eq('id', leadId)
      await supabase.from('activity_logs').insert({
        lead_id: leadId, user_id: userId,
        action: 'Deal Closed',
        details: `Closed Won — ${paymentType}${tokenAmount ? ` — ₹${tokenAmount}` : ''}. Services: ${services.join(', ')}.`,
      })
      setOutcome('won')
      onClose()
    }
    setSaving(false)
  }

  async function markLost() {
    setSaving(true)
    const error = await upsertClosing({
      outcome: 'lost',
      lost_reason: lostReason,
      lost_notes: lostNotes,
      re_nurture_date: reNurtureDate || undefined,
      re_nurture_action: reNurtureAction,
      closed_by: userId,
      closed_at: new Date().toISOString(),
    } as any)

    if (!error) {
      await supabase.from('leads').update({ status: 'Lost', updated_at: new Date().toISOString() }).eq('id', leadId)
      await supabase.from('activity_logs').insert({
        lead_id: leadId, user_id: userId,
        action: 'Lead Lost',
        details: `Not closed — reason: ${lostReason}. Re-nurture: ${reNurtureDate || 'not set'}.`,
      })
      setOutcome('lost')
      onClose()
    }
    setSaving(false)
  }

  // Already closed — show success banner
  if (closing?.outcome === 'won') {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4">🎉</div>
        <p className="text-xl font-bold text-green-300 mb-2">Deal Closed!</p>
        <p className="text-slate-400 text-sm mb-4 leading-relaxed">
          Token received. Lead status updated to <span className="text-teal-300 font-semibold">Closed Won</span>.<br />
          Developer has been notified to begin the final build.<br />
          Client revision notes and info saved to CRM record.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          {closing?.services && closing.services.length > 0 && (
            <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-left mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Services Agreed</p>
              <div className="flex flex-wrap gap-1.5">
                {closing.services.map(s => (
                  <span key={s} className="text-xs px-2.5 py-1 bg-orange-900/20 text-orange-300 border border-orange-700/25 rounded-full">{s}</span>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500 w-full">
            {closing.payment_type} · {closing.token_amount ? `₹${closing.token_amount}` : ''} · {closing.payment_method}
          </p>
        </div>
      </div>
    )
  }

  if (closing?.outcome === 'lost') {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4">📋</div>
        <p className="text-xl font-bold text-slate-300 mb-2">Marked as Not Closed</p>
        <p className="text-slate-400 text-sm mb-4">
          Reason: <span className="text-slate-300">{closing.lost_reason}</span>
          {closing.re_nurture_date && <><br />Re-nurture on: <span className="text-amber-300">{closing.re_nurture_date}</span></>}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-orange-900/15 to-orange-900/5 border border-orange-700/25 rounded-xl p-5">
        <p className="text-base font-semibold text-slate-100 mb-1">Close the deal</p>
        <p className="text-xs text-slate-400 leading-relaxed">Select the outcome, fill the details, and the system handles the rest.</p>
      </div>

      {/* Outcome buttons */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Call Outcome</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setOutcome('won')}
            className={cn('p-4 rounded-xl border text-left transition-all',
              outcome === 'won' ? 'border-green-600/60 bg-green-900/15' : 'border-slate-700 bg-slate-900 hover:bg-slate-800')}
          >
            <p className="text-xl mb-1.5">🎯</p>
            <p className="text-sm font-semibold text-slate-100 mb-1">Closed Won</p>
            <p className="text-xs text-slate-500 leading-snug">Client agreed. Token or authorization collected. Build starts in 7 days.</p>
          </button>
          <button
            onClick={() => setOutcome('lost')}
            className={cn('p-4 rounded-xl border text-left transition-all',
              outcome === 'lost' ? 'border-red-600/60 bg-red-900/10' : 'border-slate-700 bg-slate-900 hover:bg-slate-800')}
          >
            <p className="text-xl mb-1.5">📋</p>
            <p className="text-sm font-semibold text-slate-100 mb-1">Not This Time</p>
            <p className="text-xs text-slate-500 leading-snug">Client not ready. Log the reason and set a nurture reminder.</p>
          </button>
        </div>
      </div>

      {/* WON form */}
      {outcome === 'won' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          {/* Payment */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Payment & Authorization</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Payment type</label>
                <select value={paymentType} onChange={e => setPaymentType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer">
                  {PAYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Amount received (₹)</label>
                <input value={tokenAmount} onChange={e => setTokenAmount(e.target.value)} type="number" placeholder="e.g. 5000"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Payment method</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer">
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Transaction / ref ID</label>
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="UPI ref or txn ID"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
            </div>
          </div>

          {/* Services */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Services Agreed</p>
            <div className="grid grid-cols-2 gap-2">
              {SERVICES.map(s => (
                <button key={s} onClick={() => toggleService(s)}
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-all',
                    services.includes(s) ? 'border-orange-600/50 bg-orange-900/15 text-slate-200' : 'border-slate-700 text-slate-400 hover:border-slate-600')}>
                  <div className={cn('w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center',
                    services.includes(s) ? 'bg-orange-500 border-orange-500' : 'border-slate-600')}>
                    {services.includes(s) && <span className="text-white text-[8px] font-bold">✓</span>}
                  </div>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Project Timeline</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Start date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Delivery date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Duration</label>
                <input readOnly value={calcDuration()} placeholder="Auto-calculated"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-teal-400 focus:outline-none" />
              </div>
            </div>
          </div>

          {/* Client info */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Client Info Collected on Call</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Client phone (confirmed)</label>
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="+91 98XXXXXXXX"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Client email (confirmed)</label>
                <input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Client's revision notes / special requests</label>
              <textarea value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} rows={3}
                placeholder="Any specific photos, preferences, content, or changes the client requested during the call..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Closing call notes</label>
              <textarea value={closingCallNotes} onChange={e => setClosingCallNotes(e.target.value)} rows={2}
                placeholder="How did the call go? Any hesitations? What convinced them?"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none" />
            </div>
          </div>

          <Button onClick={confirmClose} loading={saving} className="w-full py-3">
            <CheckCircle size={15} /> Confirm Close — Notify Developer to Begin Build
          </Button>
        </div>
      )}

      {/* LOST form */}
      {outcome === 'lost' && (
        <div className="bg-red-900/10 border border-red-900/30 rounded-xl p-5 space-y-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Log Reason — Not Closed</p>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Primary reason</label>
            <select value={lostReason} onChange={e => setLostReason(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer">
              {LOST_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Notes</label>
            <textarea value={lostNotes} onChange={e => setLostNotes(e.target.value)} rows={3}
              placeholder="What did the client say? What objections came up?"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Re-nurture date</label>
              <input type="date" value={reNurtureDate} onChange={e => setReNurtureDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1.5">Re-nurture action</label>
              <select value={reNurtureAction} onChange={e => setReNurtureAction(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer">
                {RENURTURE_ACTIONS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <Button onClick={markLost} loading={saving} variant="secondary" className="w-full">
            <XCircle size={14} /> Mark as Not Closed — Set Re-nurture Reminder
          </Button>
        </div>
      )}
    </div>
  )
}
