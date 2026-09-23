'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileSignature, Clock, CheckCircle, Download, Ban, Hourglass, Loader2, Copy, Send, ArrowUpRight, Check } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { contractLinkExpired, CONTRACT_LINK_DAYS } from '@/lib/contract-expiry'

export interface ContractRow {
  id: string
  lead_id: string
  status: string
  business_name: string
  client_email: string
  package: string | null
  total_amount: number | null
  sent_at: string | null
  signed_at: string | null
  created_at: string | null
  signed_pdf_url: string | null
  signing_token: string
  lead_name: string | null
  lead_number: number | null
  sender_name: string | null
}

type Bucket = 'waiting' | 'signed' | 'expired' | 'cancelled'
type TabId  = 'all' | Bucket

// "Expired" isn't a stored status — it's a `sent` contract past its link window
// (lib/contract-expiry), so it's worked out here the same way the lead tab does it.
function bucketOf(c: ContractRow): Bucket {
  if (c.status === 'signed')    return 'signed'
  if (c.status === 'cancelled') return 'cancelled'
  return contractLinkExpired(c) ? 'expired' : 'waiting'
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'waiting',   label: 'Waiting' },
  { id: 'signed',    label: 'Signed' },
  { id: 'expired',   label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
]

function StatusBadge({ bucket }: { bucket: Bucket }) {
  if (bucket === 'signed') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full">
      <CheckCircle size={10} /> Signed
    </span>
  )
  if (bucket === 'cancelled') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-400/10 border border-slate-400/20 px-2 py-0.5 rounded-full">
      <Ban size={10} /> Cancelled
    </span>
  )
  if (bucket === 'expired') return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-400/10 border border-slate-400/20 px-2 py-0.5 rounded-full"
      title={`Signing links are valid for ${CONTRACT_LINK_DAYS} days`}
    >
      <Hourglass size={10} /> Expired
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
      <Clock size={10} /> Awaiting Signature
    </span>
  )
}

const actionBtn = 'flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs rounded-lg transition-colors disabled:opacity-50'

export function ContractsClient({ contracts, loadError }: { contracts: ContractRow[]; loadError: string }) {
  const router = useRouter()
  const [tab, setTab]       = useState<TabId>('waiting')
  const [busy, setBusy]     = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const withBucket = useMemo(() => contracts.map(c => ({ c, bucket: bucketOf(c) })), [contracts])
  const counts = useMemo(() => {
    const n: Record<TabId, number> = { all: withBucket.length, waiting: 0, signed: 0, expired: 0, cancelled: 0 }
    for (const { bucket } of withBucket) n[bucket]++
    return n
  }, [withBucket])
  const visible = tab === 'all' ? withBucket : withBucket.filter(r => r.bucket === tab)

  async function act(c: ContractRow, action: 'cancel' | 'resend') {
    const ok = action === 'cancel'
      ? window.confirm(`Cancel the awaiting agreement for ${c.client_email}? The signing link stops working immediately — send a new contract if terms are still wanted.`)
      : window.confirm(`Email the signing link to ${c.client_email} again?`)
    if (!ok) return
    setBusy(`${action}:${c.id}`)
    try {
      const res  = await fetch('/api/contracts', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: c.id, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Could not ${action} the contract`)
      if (action === 'resend') window.alert(`Signing link sent to ${c.client_email}`)
      router.refresh()
    } catch (e: any) {
      window.alert(e.message || `Could not ${action} the contract`)
    }
    setBusy(null)
  }

  async function copyLink(c: ContractRow) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign/${c.signing_token}`)
      setCopied(c.id)
      setTimeout(() => setCopied(prev => (prev === c.id ? null : prev)), 1500)
    } catch {
      window.alert('Could not copy the link')
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex overflow-x-auto scrollbar-hide border-b border-slate-800">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap shrink-0',
              tab === t.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            {t.label} <span className="ml-1 text-slate-500">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="p-4">
        {loadError ? (
          // A failed load must not read as "no contracts" — that looks like data loss.
          <div className="text-center py-12">
            <FileSignature className="w-10 h-10 text-red-500/40 mx-auto mb-3" />
            <p className="text-red-400 text-sm mb-1">Could not load contracts: {loadError}</p>
            <button onClick={() => router.refresh()} className="text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors">
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12">
            <FileSignature className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              {tab === 'all' ? 'No contracts sent yet' : `No ${TABS.find(t => t.id === tab)!.label.toLowerCase()} contracts`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(({ c, bucket }) => (
              <div key={c.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StatusBadge bucket={bucket} />
                      {c.lead_number != null && <span className="text-xs text-slate-600">#{c.lead_number}</span>}
                    </div>
                    <p className="text-sm font-semibold text-slate-200 truncate">{c.business_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{c.client_email}</p>
                    {(c.package || c.total_amount != null) && (
                      <p className="text-xs mt-1">
                        {c.package && <span className="text-slate-400">{c.package}</span>}
                        {c.package && c.total_amount != null && <span className="text-slate-600"> · </span>}
                        {c.total_amount != null && (
                          <span className="text-orange-400 font-semibold">${Number(c.total_amount).toFixed(2)}</span>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-slate-600 mt-1.5">
                      Sent {formatDate(c.sent_at || c.created_at)}
                      {c.sender_name && ` by ${c.sender_name}`}
                      {c.signed_at && ` · Signed ${formatDate(c.signed_at)}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
                    <Link href={`/leads/${c.lead_id}?tab=contract`} className={actionBtn}>
                      <ArrowUpRight size={12} /> Open lead
                    </Link>
                    {c.signed_pdf_url && (
                      <a href={c.signed_pdf_url} target="_blank" rel="noreferrer" className={actionBtn}>
                        <Download size={12} /> PDF
                      </a>
                    )}
                    {bucket === 'waiting' && (
                      <>
                        <button onClick={() => copyLink(c)} className={actionBtn} title="Copy the client's signing link">
                          {copied === c.id ? <Check size={12} /> : <Copy size={12} />} {copied === c.id ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                          onClick={() => act(c, 'resend')}
                          disabled={busy !== null}
                          className={actionBtn}
                          title={`Email the same link again — it still expires ${CONTRACT_LINK_DAYS} days after the original send`}
                        >
                          {busy === `resend:${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Resend
                        </button>
                        <button
                          onClick={() => act(c, 'cancel')}
                          disabled={busy !== null}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-red-500/20 text-slate-400 hover:text-red-400 text-xs rounded-lg transition-colors disabled:opacity-50"
                          title="Cancel this agreement — the signing link stops working"
                        >
                          {busy === `cancel:${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
