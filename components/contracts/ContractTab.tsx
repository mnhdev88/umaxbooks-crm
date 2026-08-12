'use client'

import { useEffect, useState } from 'react'
import { Lead, Profile } from '@/types'
import { FileSignature, Clock, CheckCircle, Download, Plus, ExternalLink } from 'lucide-react'
import { ContractModal } from './ContractModal'
import { formatDate } from '@/lib/utils'
import { readScopeItems } from '@/lib/contract-plan'

interface Props {
  lead: Lead
  profile: Profile
  userId: string
}

export function ContractTab({ lead, profile, userId }: Props) {
  const [contracts, setContracts] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [showModal, setShowModal] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/contracts?lead_id=${lead.id}`)
      const json = await res.json().catch(() => ({}))
      // A failed fetch must not look like an empty list — "No contracts sent yet"
      // on a lead that has agreements reads as data loss.
      if (!res.ok) throw new Error(json.error || 'Could not load contracts')
      setContracts(json.contracts || [])
    } catch (e: any) {
      setError(e.message || 'Could not load contracts')
      setContracts([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [lead.id])

  const canManage = profile.role === 'admin' || profile.role === 'sales_agent'
  const origin    = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Service Agreements</h3>
        {canManage && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus size={13} /> New Contract
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : error ? (
        <div className="text-center py-12">
          <FileSignature className="w-10 h-10 text-red-500/40 mx-auto mb-3" />
          <p className="text-red-400 text-sm mb-1">{error}</p>
          <button
            onClick={load}
            className="text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-12">
          <FileSignature className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm mb-1">No contracts sent yet</p>
          {canManage && (
            <button
              onClick={() => setShowModal(true)}
              className="text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              Send a contract →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map(c => (
            <div key={c.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    {c.status === 'signed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Signed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                        <Clock size={10} /> Awaiting Signature
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-200 truncate">{c.business_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.client_email}</p>
                  {c.package && (
                    <p className="text-xs text-slate-400 mt-1">{c.package}</p>
                  )}
                  {c.total_amount != null && (
                    <p className="text-xs text-orange-400 font-semibold mt-0.5">
                      ${Number(c.total_amount).toFixed(2)}
                    </p>
                  )}
                  <p className="text-xs text-slate-600 mt-1.5">
                    Sent {formatDate(c.sent_at)}
                    {c.signed_at && ` · Signed ${formatDate(c.signed_at)}`}
                  </p>

                  {/* What this client was actually promised */}
                  <details className="mt-2 group">
                    <summary className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer list-none transition-colors">
                      Scope of services ({readScopeItems(c.scope_items).length} items)
                      <span className="ml-1 text-slate-600 group-open:hidden">▸</span>
                      <span className="ml-1 text-slate-600 hidden group-open:inline">▾</span>
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {readScopeItems(c.scope_items).map((item, i) => (
                        <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                          <span className="text-slate-600">•</span>{item}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>

                <div className="flex flex-col gap-2 flex-shrink-0">
                  {c.signed_pdf_url && (
                    <a
                      href={c.signed_pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs rounded-lg transition-colors"
                    >
                      <Download size={12} /> PDF
                    </a>
                  )}
                  {c.status === 'sent' && canManage && (
                    <a
                      href={`${origin}/sign/${c.signing_token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200 text-xs rounded-lg transition-colors"
                      title="Preview signing link"
                    >
                      <ExternalLink size={12} /> Preview
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ContractModal
          lead={lead}
          profile={profile}
          onClose={() => setShowModal(false)}
          onSent={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}
