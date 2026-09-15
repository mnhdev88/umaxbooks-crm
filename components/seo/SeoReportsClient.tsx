'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Send, CheckCircle2, FileText, ChevronDown, ChevronRight } from 'lucide-react'

// Review-and-send. The draft arrives with every number already filled in, so the
// only thing asked of the agent is the part a machine can't write: two sentences
// explaining what the month meant for this client.

interface Row {
  id: string
  site_id: string
  period_start: string
  period_end: string
  data: any
  commentary: string | null
  status: 'draft' | 'sent'
  sent_at: string | null
  sent_to: string | null
  generated_by: 'auto' | 'manual'
  created_at: string
  site_url: string | null
  default_to: string | null
  business: string
}

function periodLabel(periodStart: string): string {
  return new Date(`${periodStart}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-500'
  if (score >= 70) return 'text-green-400'
  if (score >= 50) return 'text-orange-400'
  return 'text-red-400'
}

export function SeoReportsClient({ rows }: { rows: Row[] }) {
  const drafts = rows.filter(r => r.status === 'draft')
  const sent   = rows.filter(r => r.status === 'sent')

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Client Reports</h1>
        <p className="text-slate-400 text-sm">
          Monthly SEO reports, built from the checks and work already recorded in the CRM.
        </p>
      </div>

      <h2 className="text-sm font-semibold text-slate-300 mb-3">
        Waiting to send {drafts.length > 0 && <span className="text-orange-400">({drafts.length})</span>}
      </h2>

      {drafts.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center mb-8">
          <CheckCircle2 size={30} className="text-green-500/60 mx-auto mb-3" />
          <p className="text-slate-300">Nothing waiting.</p>
          <p className="text-slate-500 text-xs mt-1">
            Next month&apos;s drafts are built automatically on the 1st.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {drafts.map(row => <DraftCard key={row.id} row={row} />)}
        </div>
      )}

      {sent.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Already sent</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-800">
            {sent.map(row => (
              <div key={row.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">
                    {row.business} <span className="text-slate-500">· {periodLabel(row.period_start)}</span>
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    Sent {row.sent_at ? new Date(row.sent_at).toLocaleDateString('en-US', { dateStyle: 'medium' }) : ''} to {row.sent_to}
                  </p>
                </div>
                <Link
                  href={`/seo/${row.site_id}`}
                  className="text-xs text-slate-400 hover:text-orange-400 transition-colors shrink-0"
                >
                  Site
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DraftCard({ row }: { row: Row }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [commentary, setCommentary] = useState(row.commentary ?? '')
  const [to, setTo] = useState(row.default_to ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const data = row.data ?? {}
  const current = data.current ?? {}
  const previous = data.previous ?? {}

  const metrics = [
    { label: 'On-Page', now: current.onpage,  before: previous.onpage },
    { label: 'SEO',     now: current.psiSeo,  before: previous.psiSeo },
    { label: 'Speed',   now: current.psiPerf, before: previous.psiPerf },
  ]

  async function send() {
    if (!to.trim()) { setError('Add a recipient email.'); return }
    setSending(true)
    setError(null)
    const res = await fetch('/api/seo/report/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: row.id, to: to.trim(), commentary }),
    })
    const result = await res.json()
    setSending(false)
    if (res.ok) router.refresh()
    else setError(result.error || 'Could not send.')
  }

  const fixedCount = (data.fixed ?? []).length
  const taskCount  = (data.tasks ?? []).length
  const openCount  = (data.open ?? []).length

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-white font-medium">
              {row.business}
              <span className="text-slate-500 font-normal"> · {periodLabel(row.period_start)}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {fixedCount} issue{fixedCount === 1 ? '' : 's'} fixed · {taskCount} task{taskCount === 1 ? '' : 's'} delivered · {openCount} still open
            </p>
          </div>
          <div className="flex items-center gap-4">
            {metrics.map(m => {
              const delta = m.now != null && m.before != null ? m.now - m.before : null
              return (
                <div key={m.label} className="text-center">
                  <div className={`text-lg font-bold ${scoreClass(m.now)}`}>{m.now ?? '—'}</div>
                  <div className="text-[10px] text-slate-500">{m.label}</div>
                  {delta !== null && delta !== 0 && (
                    <div className={`text-[10px] ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {delta > 0 ? '+' : ''}{delta}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* A score that fell is exactly the report that must not go out without a
            human sentence, so say so rather than hoping it gets noticed. */}
        {current.onpage != null && previous.onpage != null && current.onpage < previous.onpage && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs text-orange-300">
            The score dropped this month. Explain why in your notes before sending.
          </div>
        )}

        <button
          onClick={() => setOpen(v => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 transition-colors"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? 'Hide' : 'Review and send'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-700 p-4 space-y-4 bg-slate-900/30">
          <DetailList title="What we fixed" items={(data.fixed ?? []).map((f: any) => f.label)} empty="Nothing needed fixing." />
          <DetailList title="Work delivered" items={(data.tasks ?? []).map((t: any) => t.title)} empty="No tasks recorded for this month." />
          <DetailList title="Still open" items={(data.open ?? []).map((o: any) => o.label)} empty="Nothing outstanding." />

          <div>
            <label htmlFor={`note-${row.id}`} className="block text-xs text-slate-400 mb-1.5">
              Your notes to the client
            </label>
            <textarea
              id={`note-${row.id}`}
              value={commentary}
              onChange={e => setCommentary(e.target.value)}
              rows={4}
              placeholder="Two or three sentences on what this month meant for them and what's next."
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2
                         placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-y"
            />
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[14rem]">
              <label htmlFor={`to-${row.id}`} className="block text-xs text-slate-400 mb-1.5">Send to</label>
              <input
                id={`to-${row.id}`}
                type="email"
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="client@example.com"
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2
                           placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
              />
            </div>
            <button
              onClick={send}
              disabled={sending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white transition-colors"
            >
              <Send size={14} /> {sending ? 'Sending…' : 'Send report'}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <FileText size={11} /> The client gets this summary as an email with a PDF attached.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

function DetailList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="text-sm text-slate-300 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-orange-400 mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
