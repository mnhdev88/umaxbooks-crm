import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getPortalLeadId } from '@/lib/portal-context'
import { Deal } from '@/types'
import { Receipt, CheckCircle2, Clock, AlertTriangle, XCircle, CreditCard } from 'lucide-react'

const PAYMENT_STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  Paid:    { icon: CheckCircle2,   color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30'  },
  Partial: { icon: Clock,          color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  Pending: { icon: Clock,          color: 'text-slate-400',  bg: 'bg-slate-500/10 border-slate-500/30'  },
  Overdue: { icon: AlertTriangle,  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30'      },
}

function formatCurrency(amount?: number) {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

export default async function InvoicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  if (!leadId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Receipt size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">No invoice information available yet.</p>
        </div>
      </div>
    )
  }

  const { data: deals } = await supabase
    .from('deals')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  const allDeals = (deals ?? []) as Deal[]

  if (allDeals.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-white mb-1">Invoices & Payments</h1>
        <p className="text-slate-400 text-sm mb-8">Your payment summary and service details</p>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
          <Receipt size={36} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">No invoices on file yet.</p>
          <p className="text-slate-500 text-xs mt-1">Your project details will appear here once set up.</p>
        </div>
      </div>
    )
  }

  const totalToken = allDeals.reduce((s, d) => s + (d.token_amount ?? 0), 0)
  const totalFinal = allDeals.reduce((s, d) => s + (d.final_payment_amount ?? 0), 0)
  const totalDue   = totalToken + totalFinal

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-1">Invoices & Payments</h1>
      <p className="text-slate-400 text-sm mb-8">Your payment summary and service details</p>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Token / Deposit</p>
          <p className="text-xl font-semibold text-orange-400">{formatCurrency(totalToken)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Final Payment</p>
          <p className="text-xl font-semibold text-orange-400">{formatCurrency(totalFinal)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Total Amount</p>
          <p className="text-xl font-semibold text-white">{formatCurrency(totalDue)}</p>
        </div>
      </div>

      {/* Deal cards */}
      <div className="space-y-4">
        {allDeals.map((deal, index) => {
          const cfg = PAYMENT_STATUS_CONFIG[deal.payment_status] ?? PAYMENT_STATUS_CONFIG.Pending
          const StatusIcon = cfg.icon
          return (
            <div
              key={deal.id}
              className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden"
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                    <CreditCard size={15} className="text-orange-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Invoice #{String(index + 1).padStart(3, '0')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(deal.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                    </p>
                  </div>
                </div>
                <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
                  <StatusIcon size={12} />
                  {deal.payment_status}
                </span>
              </div>

              {/* Card body */}
              <div className="px-5 py-4">
                {/* Services */}
                {deal.services?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 mb-2">Services</p>
                    <div className="flex flex-wrap gap-1.5">
                      {deal.services.map((s) => (
                        <span
                          key={s}
                          className="px-2.5 py-0.5 rounded-full text-xs bg-slate-700/60 text-slate-300 border border-slate-600/40"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payment breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Token / Deposit</p>
                    <p className="text-white font-medium">{formatCurrency(deal.token_amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Final Payment</p>
                    <p className="text-white font-medium">{formatCurrency(deal.final_payment_amount)}</p>
                  </div>
                  {deal.start_date && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">Start Date</p>
                      <p className="text-white">{new Date(deal.start_date).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
                    </div>
                  )}
                  {deal.end_date && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">End Date</p>
                      <p className="text-white">{new Date(deal.end_date).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
                    </div>
                  )}
                  {deal.duration_days != null && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">Duration</p>
                      <p className="text-white">{deal.duration_days} days</p>
                    </div>
                  )}
                </div>

                {/* Payment next-step CTA for unsettled invoices */}
                {deal.payment_status !== 'Paid' && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg bg-orange-500/10 border border-orange-500/30 px-4 py-3">
                    <CreditCard size={15} className="text-orange-400 mt-0.5 shrink-0" aria-hidden="true" />
                    <p className="text-xs text-slate-300">
                      To settle this balance, contact your account manager and we&apos;ll share secure payment instructions.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
