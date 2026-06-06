'use client'

import { useState } from 'react'
import { MailX, ExternalLink, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface UnsubscribedLead {
  id: string
  lead_number: number | null
  company_name: string
  email: string | null
  email_unsubscribed_at: string | null
}

interface Props {
  initialLeads: UnsubscribedLead[]
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function UnsubscribesClient({ initialLeads }: Props) {
  const [leads, setLeads] = useState<UnsubscribedLead[]>(initialLeads)
  const [resubscribing, setResubscribing] = useState<string | null>(null)

  async function handleResubscribe(lead: UnsubscribedLead) {
    setResubscribing(lead.id)
    try {
      const res = await fetch('/api/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setLeads(prev => prev.filter(l => l.id !== lead.id))
      toast.success(`${lead.company_name} has been re-subscribed.`)
    } catch (err: any) {
      toast.error(err.message || 'Failed to re-subscribe.')
    } finally {
      setResubscribing(null)
    }
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
        <MailX size={40} className="text-slate-700" />
        <p className="text-slate-400 font-medium">No unsubscribed leads</p>
        <p className="text-slate-600 text-sm">When a lead unsubscribes from emails, they'll appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <MailX size={16} className="text-red-400" />
        <h2 className="text-sm font-semibold text-slate-300">
          {leads.length} unsubscribed lead{leads.length !== 1 ? 's' : ''}
        </h2>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-800 text-left">
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Lead ID</th>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Company</th>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Email</th>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Unsubscribed At</th>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead, i) => (
              <tr
                key={lead.id}
                className={`border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-800/10'}`}
              >
                <td className="px-4 py-3">
                  {lead.lead_number ? (
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-700/60 text-slate-400 border border-slate-600/40">
                      NVL-{String(lead.lead_number).padStart(3, '0')}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-200 font-medium">{lead.company_name}</td>
                <td className="px-4 py-3 text-slate-400">{lead.email || '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(lead.email_unsubscribed_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => window.open(`/leads/${lead.id}`, '_blank')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-600/40"
                    >
                      <ExternalLink size={11} />
                      Open Lead
                    </button>
                    <button
                      onClick={() => handleResubscribe(lead)}
                      disabled={resubscribing === lead.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-950/60 text-green-400 hover:bg-green-900/60 hover:text-green-300 transition-colors border border-green-800/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resubscribing === lead.id
                        ? <Loader2 size={11} className="animate-spin" />
                        : <RotateCcw size={11} />
                      }
                      Re-subscribe
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
