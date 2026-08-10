'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
import { Lead, Profile } from '@/types'
import { X, FileSignature, Loader2, CheckCircle, CalendarClock } from 'lucide-react'
import {
  CONTRACT_PACKAGES as PACKAGES, MIN_MONTHS, MAX_MONTHS,
  FALLBACK_PACKAGE_DEFAULTS, buildInstallmentPlan, prettyDate, usd, round2,
  type PackageDefaults,
} from '@/lib/contract-plan'

/** Quick-set chips for the down payment, as a share of the total. */
const DOWN_PCT_CHIPS = [0, 25, 33, 50, 75]

interface Props {
  lead: Lead
  profile: Profile
  onClose: () => void
  onSent: () => void
}

export function ContractModal({ lead, profile, onClose, onSent }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    business_name:     lead.company_name || '',
    contact_person:    lead.name || '',
    address:           lead.address || '',
    city:              lead.city || '',
    state:             lead.state || '',
    zip_code:          lead.zip_code || '',
    phone:             lead.phone || '',
    client_email:      lead.email || '',
    package:           '',
    project_name:      lead.website_url?.replace(/^https?:\/\//, '').replace(/\/$/, '') || '',
    start_date:        today,
    delivery_timeline: '',
    payment_type:      '',
    total_amount:      '',
    down_payment:      '',
    installment_count: '',
    rep_name:          profile.full_name || '',
    rep_title:         '',
    rep_sign_date:     today,
  })

  const [pkgDefaults, setPkgDefaults] = useState<PackageDefaults>(FALLBACK_PACKAGE_DEFAULTS)

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing]   = useState(false)
  const [hasSig, setHasSig]     = useState(false)
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const [sent, setSent]         = useState(false)

  const set = (k: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvas.offsetWidth === 0) return
    canvas.width = canvas.offsetWidth
  }, [])

  // Admin-configured suggestions per package (Settings → Contract Packages).
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/contract-packages')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.defaults) setPkgDefaults(d.defaults) })
      .catch(() => { /* fall back to the built-in suggestions */ })
    return () => { cancelled = true }
  }, [])

  const isInstallment = form.payment_type === 'Installment'

  const plan = useMemo(() => buildInstallmentPlan({
    total:     Number(form.total_amount),
    down:      Number(form.down_payment) || 0,
    months:    Number(form.installment_count),
    startDate: form.start_date,
  }), [form.total_amount, form.down_payment, form.installment_count, form.start_date])

  /**
   * Picking a package pre-fills the suggested numbers, but never overwrites a
   * figure the rep has already typed for this contract.
   */
  function onPackageChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const pkg = e.target.value
    const d   = pkgDefaults[pkg]
    setForm(f => {
      const next = { ...f, package: pkg }
      if (!d) return next
      if (!f.total_amount && d.total > 0) next.total_amount = String(d.total)
      const total = Number(next.total_amount) || 0
      if (!f.installment_count) next.installment_count = String(d.months)
      if (!f.down_payment && total > 0) next.down_payment = String(round2(total * d.down_pct / 100))
      return next
    })
  }

  /** Down-payment quick-set: percentage of the current total. */
  function setDownPct(pct: number) {
    const total = Number(form.total_amount) || 0
    setForm(f => ({ ...f, down_payment: total > 0 ? String(round2(total * pct / 100)) : '' }))
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return [s.clientX - r.left, s.clientY - r.top]
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    setDrawing(true)
    const [x, y] = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!drawing) return
    const ctx = canvasRef.current!.getContext('2d')!
    const [x, y] = getPos(e)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#1F3A93'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
    setHasSig(true)
  }

  function clearSig() {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setHasSig(false)
  }

  async function handleSend() {
    setError('')
    if (!form.client_email)      return setError('Client email is required')
    if (!form.package)           return setError('Please select a package')
    if (!form.payment_type)      return setError('Please select a payment type')
    if (!form.total_amount)      return setError('Please enter the total amount')
    if (!form.delivery_timeline) return setError('Please enter the delivery timeline')
    if (!form.rep_title)         return setError('Please enter your title (e.g. CEO)')
    if (isInstallment && plan.error) return setError(plan.error)
    if (!hasSig)                 return setError('Please draw your signature before sending')

    const rep_signature = canvasRef.current!.toDataURL('image/png')
    setSending(true)
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          total_amount: parseFloat(form.total_amount) || 0,
          // The server rebuilds the schedule from these three, so only the
          // inputs are sent — never the derived monthly figure or the rows.
          down_payment:      isInstallment ? plan.down   : null,
          installment_count: isInstallment ? plan.months : null,
          rep_signature,
          lead_id: lead.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setSent(true)
      setTimeout(onSent, 2000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl p-12 text-center max-w-sm w-full border border-slate-700">
        <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Contract Sent!</h3>
        <p className="text-slate-400 text-sm">Signing link emailed to<br /><strong className="text-slate-200">{form.client_email}</strong></p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 rounded-2xl w-full max-w-2xl my-6 border border-slate-700 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <FileSignature className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-bold text-white">Send Service Agreement</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-7">

          {/* 1 — Client Info */}
          <section>
            <SectionTitle>1 · Client Information</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Business Name *"   value={form.business_name}   onChange={set('business_name')} />
              <Field label="Contact Person"     value={form.contact_person}  onChange={set('contact_person')} />
              <Field label="Billing Address"    value={form.address}         onChange={set('address')} className="col-span-2" />
              <Field label="City"               value={form.city}            onChange={set('city')} />
              <Field label="State"              value={form.state}           onChange={set('state')} placeholder="e.g. NJ" />
              <Field label="ZIP Code"           value={form.zip_code}        onChange={set('zip_code')} />
              <Field label="Phone"              value={form.phone}           onChange={set('phone')} />
              <Field label="Client Email *"     value={form.client_email}    onChange={set('client_email')} type="email" className="col-span-2" />
            </div>
          </section>

          {/* 2 — Service Details */}
          <section>
            <SectionTitle>2 · Service Details</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <FieldLabel>Package *</FieldLabel>
                <select
                  value={form.package}
                  onChange={onPackageChange}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
                >
                  <option value="">— Select a package —</option>
                  {PACKAGES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <Field label="Project / Website Name" value={form.project_name}      onChange={set('project_name')} placeholder="e.g. mybusiness.com" className="col-span-2" />
              <Field label="Service Start Date *"   value={form.start_date}        onChange={set('start_date')} type="date" />
              <Field label="Delivery Timeline *"    value={form.delivery_timeline} onChange={set('delivery_timeline')} placeholder="e.g. 14 days" />
              <div>
                <FieldLabel>Payment Type *</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {['One-Time', 'Installment'].map(pt => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, payment_type: pt }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.payment_type === pt
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 bg-slate-800'
                      }`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Total Amount (USD) *" value={form.total_amount} onChange={set('total_amount')} type="number" placeholder="0.00" />

              {/* Installment plan builder — down payment + N equal months */}
              {isInstallment && (
                <div className="col-span-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={14} className="text-orange-400" />
                    <p className="text-xs font-semibold text-slate-300">Installment Plan</p>
                    <span className="text-[11px] text-slate-500">
                      A down payment at signing, then equal monthly payments.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Down Payment (USD)</FieldLabel>
                      <input
                        type="number" min="0" step="0.01"
                        value={form.down_payment}
                        onChange={set('down_payment')}
                        placeholder="0.00"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500 placeholder-slate-600"
                      />
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {DOWN_PCT_CHIPS.map(pct => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setDownPct(pct)}
                            disabled={!(Number(form.total_amount) > 0)}
                            className="px-2 py-1 rounded-md text-[11px] font-medium border border-slate-700 bg-slate-800 text-slate-400 hover:border-orange-500 hover:text-orange-400 disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-400 transition-colors"
                          >
                            {pct === 0 ? 'None' : `${pct}%`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <FieldLabel>Monthly Payments *</FieldLabel>
                      <input
                        type="number" min={MIN_MONTHS} max={MAX_MONTHS} step="1"
                        value={form.installment_count}
                        onChange={set('installment_count')}
                        placeholder={`${MIN_MONTHS}–${MAX_MONTHS}`}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500 placeholder-slate-600"
                      />
                      <p className="text-[11px] text-slate-500 mt-2">
                        {plan.error
                          ? `How many months to spread the balance over (${MIN_MONTHS}–${MAX_MONTHS}).`
                          : <>Balance of <strong className="text-slate-300">{usd(plan.financed)}</strong> over {plan.months} months.</>}
                      </p>
                    </div>
                  </div>

                  {plan.error ? (
                    <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                      {plan.error}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-2xl font-bold text-orange-400">{usd(plan.monthly)}</span>
                        <span className="text-sm text-slate-400">/ month × {plan.months}</span>
                        {plan.down > 0 && (
                          <span className="text-xs text-slate-500">
                            after {usd(plan.down)} down
                          </span>
                        )}
                        {plan.finalMonthly !== plan.monthly && (
                          <span className="text-xs text-slate-500">
                            (final payment {usd(plan.finalMonthly)})
                          </span>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-700 overflow-hidden">
                        <table className="w-full text-xs">
                          <tbody>
                            {plan.schedule.map((row, i) => (
                              <tr key={i} className={i % 2 ? 'bg-slate-900/40' : ''}>
                                <td className="px-3 py-1.5 text-slate-400">{row.label}</td>
                                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{prettyDate(row.due_date)}</td>
                                <td className="px-3 py-1.5 text-right text-slate-200 font-medium whitespace-nowrap">{usd(row.amount)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-slate-700 bg-slate-900/60">
                              <td className="px-3 py-1.5 text-slate-400 font-semibold" colSpan={2}>Total</td>
                              <td className="px-3 py-1.5 text-right text-orange-400 font-bold whitespace-nowrap">{usd(plan.total)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <p className="text-[11px] text-slate-600">
                        Dates are generated from the Service Start Date. The client sees this exact
                        schedule and cannot change it.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 3 — Rep Signature */}
          <section>
            <SectionTitle>3 · Your Signature (Novelio Representative)</SectionTitle>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Field label="Your Full Name *" value={form.rep_name}      onChange={set('rep_name')} />
              <Field label="Your Title *"     value={form.rep_title}     onChange={set('rep_title')} placeholder="e.g. CEO" />
              <Field label="Date Signed"      value={form.rep_sign_date} onChange={set('rep_sign_date')} type="date" className="col-span-2" />
            </div>
            <div>
              <FieldLabel>Draw Signature *</FieldLabel>
              <div className="relative mt-1.5">
                <canvas
                  ref={canvasRef}
                  height={110}
                  className={`w-full rounded-lg cursor-crosshair touch-none border ${
                    hasSig ? 'border-orange-500 bg-slate-800' : 'border-dashed border-slate-600 bg-slate-800/50'
                  }`}
                  onMouseDown={onDown} onMouseMove={onMove}
                  onMouseUp={() => setDrawing(false)} onMouseLeave={() => setDrawing(false)}
                  onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={() => setDrawing(false)}
                />
                {!hasSig && (
                  <span className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm pointer-events-none select-none">
                    Draw your signature here
                  </span>
                )}
              </div>
              {hasSig && (
                <button onClick={clearSig} className="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors">
                  ✕ Clear signature
                </button>
              )}
            </div>
          </section>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <FileSignature size={15} />}
              {sending ? 'Sending…' : 'Send Contract to Client'}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 text-slate-500 hover:text-slate-300 text-sm transition-colors">
              Cancel
            </button>
          </div>

          <p className="text-xs text-slate-600">
            The client will receive an email with a unique signing link. You will be notified when they sign.
          </p>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 pb-2 border-b border-slate-800">
      {children}
    </p>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide block mb-1.5">{children}</label>
}

function Field({
  label, value, onChange, type = 'text', placeholder = '', className = ''
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  className?: string
}) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500 placeholder-slate-600"
      />
    </div>
  )
}
