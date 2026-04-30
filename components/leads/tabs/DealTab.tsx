'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Deal, SERVICE_OPTIONS, ServiceType } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import { DollarSign, Calendar, Edit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface DealTabProps {
  leadId: string
  userId: string
  userRole: string
}

const PAYMENT_STATUS_OPTIONS = [
  { value: 'Pending', label: 'Pending' },
  { value: 'Partial', label: 'Partial' },
  { value: 'Paid', label: 'Paid' },
  { value: 'Overdue', label: 'Overdue' },
]

const PAYMENT_COLORS: Record<string, string> = {
  Pending: 'text-yellow-400 bg-yellow-900/30',
  Partial: 'text-blue-400 bg-blue-900/30',
  Paid: 'text-green-400 bg-green-900/30',
  Overdue: 'text-red-400 bg-red-900/30',
}

export function DealTab({ leadId, userId, userRole }: DealTabProps) {
  const [deal, setDeal] = useState<Deal | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    services: [] as ServiceType[],
    start_date: '',
    end_date: '',
    token_amount: '',
    final_payment_amount: '',
    payment_status: 'Pending',
  })
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => { fetchDeal() }, [leadId])

  async function fetchDeal() {
    const { data } = await supabase.from('deals').select('*').eq('lead_id', leadId).maybeSingle()
    if (data) {
      setDeal(data)
      setForm({
        services: data.services || [],
        start_date: data.start_date || '',
        end_date: data.end_date || '',
        token_amount: data.token_amount?.toString() || '',
        final_payment_amount: data.final_payment_amount?.toString() || '',
        payment_status: data.payment_status || 'Pending',
      })
    }
  }

  function toggleService(s: ServiceType) {
    setForm((f) => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s],
    }))
  }

  async function handleSave() {
    setLoading(true)
    const prevStatus = deal?.payment_status

    const payload = {
      lead_id: leadId,
      services: form.services,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      token_amount: form.token_amount ? parseFloat(form.token_amount) : null,
      final_payment_amount: form.final_payment_amount ? parseFloat(form.final_payment_amount) : null,
      payment_status: form.payment_status,
    }

    if (deal) {
      await supabase.from('deals').update(payload).eq('id', deal.id)
    } else {
      await supabase.from('deals').insert(payload)
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: deal ? 'Deal Updated' : 'Deal Created',
      details: `Payment status: ${form.payment_status}`,
    })

    // Trigger go-live notification when payment received
    if (form.payment_status === 'Paid' && prevStatus !== 'Paid') {
      await fetch('/api/notifications/payment-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, amount: payload.final_payment_amount }),
      })
    }

    setShowModal(false)
    setLoading(false)
    fetchDeal()
    router.refresh()
  }

  const canEdit = userRole === 'admin' || userRole === 'sales_agent'

  const durationDays = form.start_date && form.end_date
    ? Math.ceil((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86400000)
    : null

  return (
    <div className="space-y-4">
      {deal ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-100">Deal Details</h3>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setShowModal(true)}>
                <Edit2 size={13} /> Edit
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {deal.services.map((s) => (
              <span key={s} className="text-xs bg-orange-500/20 text-orange-300 px-2.5 py-1 rounded-full">{s}</span>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Start Date</p>
              <p className="text-sm text-slate-200 flex items-center gap-1.5">
                <Calendar size={13} className="text-orange-400" />
                {formatDate(deal.start_date)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">End Date</p>
              <p className="text-sm text-slate-200 flex items-center gap-1.5">
                <Calendar size={13} className="text-orange-400" />
                {formatDate(deal.end_date)}
              </p>
            </div>
            {deal.duration_days && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Duration</p>
                <p className="text-sm text-slate-200">{deal.duration_days} days</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-500 mb-1">Payment Status</p>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${PAYMENT_COLORS[deal.payment_status]}`}>
                {deal.payment_status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {deal.token_amount && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Token Amount</p>
                <p className="text-sm text-slate-200 flex items-center gap-1">
                  <DollarSign size={13} className="text-green-400" />
                  {deal.token_amount.toLocaleString()}
                </p>
              </div>
            )}
            {deal.final_payment_amount && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Final Payment</p>
                <p className="text-sm text-slate-200 flex items-center gap-1">
                  <DollarSign size={13} className="text-green-400" />
                  {deal.final_payment_amount.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 text-sm">
          No deal created yet.
          {canEdit && (
            <div className="mt-3">
              <Button size="sm" onClick={() => setShowModal(true)}>Create Deal</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={deal ? 'Edit Deal' : 'Create Deal'} size="lg">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-2">Services</label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleService(s)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-all border ${
                    form.services.includes(s)
                      ? 'bg-orange-500 border-orange-500 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-orange-500/50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Date" type="date" value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            <Input label="End Date" type="date" value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
          </div>

          {durationDays !== null && (
            <p className="text-xs text-slate-400">Duration: <span className="text-orange-400 font-semibold">{durationDays} days</span></p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input label="Token Amount ($)" type="number" value={form.token_amount}
              onChange={(e) => setForm((f) => ({ ...f, token_amount: e.target.value }))} />
            <Input label="Final Payment ($)" type="number" value={form.final_payment_amount}
              onChange={(e) => setForm((f) => ({ ...f, final_payment_amount: e.target.value }))} />
          </div>

          <Select label="Payment Status" options={PAYMENT_STATUS_OPTIONS} value={form.payment_status}
            onChange={(e) => setForm((f) => ({ ...f, payment_status: e.target.value }))} />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>Save Deal</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
