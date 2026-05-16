import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FileText, Download, CheckCircle } from 'lucide-react'
import { getPortalLeadId } from '@/lib/portal-context'

export default async function PortalContractPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  if (!leadId) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-6">Contract &amp; Payment</h1>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <FileText size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">No contract on file yet.</p>
        </div>
      </div>
    )
  }

  const [{ data: contract }, { data: deal }] = await Promise.all([
    supabase.from('contracts')
      .select('business_name, contact_person, package, project_name, start_date, delivery_timeline, total_amount, payment_type, signed_at, signed_pdf_url, status, first_payment, installment_payment, balance_payment')
      .eq('lead_id', leadId)
      .eq('status', 'signed')
      .maybeSingle(),
    supabase.from('deals')
      .select('services, payment_status, token_amount, final_payment_amount, start_date, end_date')
      .eq('lead_id', leadId)
      .maybeSingle(),
  ])

  return (
    <div className="p-8 max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Contract &amp; Payment</h1>
        <p className="text-slate-400 text-sm">Your signed agreement and payment details</p>
      </div>

      {contract ? (
        <>
          {/* Contract card */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <CheckCircle size={16} className="text-green-400" />
              <span className="text-green-400 font-medium text-sm">Contract Signed</span>
              {contract.signed_at && (
                <span className="text-slate-500 text-xs ml-auto">
                  {new Date(contract.signed_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                </span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm mb-6">
              {contract.package && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Package</dt>
                  <dd className="text-white font-medium">{contract.package}</dd>
                </div>
              )}
              {contract.project_name && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Project</dt>
                  <dd className="text-white">{contract.project_name}</dd>
                </div>
              )}
              {contract.total_amount != null && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Total Amount</dt>
                  <dd className="text-white font-semibold">
                    ${Number(contract.total_amount).toLocaleString()}
                  </dd>
                </div>
              )}
              {contract.payment_type && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Payment Type</dt>
                  <dd className="text-white">{contract.payment_type}</dd>
                </div>
              )}
              {contract.start_date && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Start Date</dt>
                  <dd className="text-white">
                    {new Date(contract.start_date).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                  </dd>
                </div>
              )}
              {contract.delivery_timeline && (
                <div>
                  <dt className="text-slate-500 mb-0.5">Delivery Timeline</dt>
                  <dd className="text-white">{contract.delivery_timeline}</dd>
                </div>
              )}
            </dl>

            {/* Payment breakdown */}
            {(contract.first_payment != null || contract.installment_payment != null || contract.balance_payment != null) && (
              <div className="border-t border-slate-700 pt-4 mb-5">
                <p className="text-xs text-slate-500 mb-3">Payment Breakdown</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  {contract.first_payment != null && (
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <p className="text-slate-500 text-xs mb-1">Token</p>
                      <p className="text-white font-semibold">${Number(contract.first_payment).toLocaleString()}</p>
                    </div>
                  )}
                  {contract.installment_payment != null && (
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <p className="text-slate-500 text-xs mb-1">Installment</p>
                      <p className="text-white font-semibold">${Number(contract.installment_payment).toLocaleString()}</p>
                    </div>
                  )}
                  {contract.balance_payment != null && (
                    <div className="bg-slate-900/60 rounded-lg p-3">
                      <p className="text-slate-500 text-xs mb-1">Balance</p>
                      <p className="text-white font-semibold">${Number(contract.balance_payment).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {contract.signed_pdf_url && (
              <a
                href={contract.signed_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600
                           text-white text-sm rounded-lg transition-colors font-medium"
              >
                <Download size={14} />
                Download Signed Contract
              </a>
            )}
          </div>

          {/* Payment status */}
          {deal && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Payment Status</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  deal.payment_status === 'Paid'    ? 'bg-green-500/20 text-green-400' :
                  deal.payment_status === 'Partial' ? 'bg-yellow-500/20 text-yellow-400' :
                  deal.payment_status === 'Overdue' ? 'bg-red-500/20 text-red-400' :
                                                      'bg-slate-600/50 text-slate-300'
                }`}>
                  {deal.payment_status}
                </span>
                {(deal.services as string[])?.length > 0 && (
                  <span className="text-slate-400 text-sm">
                    {(deal.services as string[]).join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <FileText size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">No signed contract on file yet.</p>
          <p className="text-slate-500 text-xs mt-2">
            Once your contract is signed, it will appear here for download.
          </p>
        </div>
      )}
    </div>
  )
}
