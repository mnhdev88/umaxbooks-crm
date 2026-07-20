'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn, formatDate, ensureHttps } from '@/lib/utils'
import { CopyButton } from '@/components/ui/CopyButton'
import {
  Search, ExternalLink, Monitor, Clock, CheckCircle2, XCircle,
  Code2, ArrowUpRight, MonitorPlay,
} from 'lucide-react'

export interface DemoRow {
  id: string
  leadId: string
  companyName: string
  contactName: string | null
  city: string | null
  leadStatus: string | null
  agentName: string | null
  developerName: string | null
  tempUrl: string
  demoVersion: string | null
  uploadDate: string | null
  createdAt: string
  approvalStatus: 'pending' | 'approved' | 'declined' | null
  revisionNotes: string | null
}

const APPROVAL_BADGE = {
  pending:  { cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50', Icon: Clock,        label: 'Pending' },
  approved: { cls: 'bg-green-900/40 text-green-300 border-green-700/50', Icon: CheckCircle2, label: 'Approved' },
  declined: { cls: 'bg-red-900/40 text-red-300 border-red-700/50',       Icon: XCircle,      label: 'Declined' },
} as const

type FilterKey = 'all' | 'approved' | 'pending' | 'declined'

export function DemosClient({ rows, role }: { rows: DemoRow[]; role: string }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')

  const isSalesRole = role === 'sales_agent' || role === 'sales_manager'

  // Sales agents/managers only see demos an admin has cleared (approved) or that
  // carry no approval record at all — same rule as the per-lead Demo tab.
  const permitted = useMemo(
    () => (isSalesRole
      ? rows.filter(r => r.approvalStatus === null || r.approvalStatus === 'approved')
      : rows),
    [rows, isSalesRole],
  )

  const counts = useMemo(() => ({
    all:      permitted.length,
    approved: permitted.filter(r => r.approvalStatus === 'approved').length,
    pending:  permitted.filter(r => r.approvalStatus === 'pending').length,
    declined: permitted.filter(r => r.approvalStatus === 'declined').length,
  }), [permitted])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return permitted.filter(r => {
      if (filter !== 'all' && r.approvalStatus !== filter) return false
      if (!q) return true
      return (
        r.companyName.toLowerCase().includes(q) ||
        (r.contactName || '').toLowerCase().includes(q) ||
        (r.demoVersion || '').toLowerCase().includes(q) ||
        (r.developerName || '').toLowerCase().includes(q) ||
        r.tempUrl.toLowerCase().includes(q)
      )
    })
  }, [permitted, search, filter])

  // Filter chips — hidden for sales roles (they only ever see approved demos).
  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',      label: 'All',      count: counts.all },
    { key: 'approved', label: 'Approved', count: counts.approved },
    { key: 'pending',  label: 'Pending',  count: counts.pending },
    { key: 'declined', label: 'Declined', count: counts.declined },
  ]

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by company, version, developer or URL…"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>
        {!isSalesRole && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                  filter === f.key
                    ? 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200',
                )}
              >
                {f.label} <span className="opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <MonitorPlay size={30} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {search || filter !== 'all' ? 'No demos match your filters.' : 'No demos yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(demo => {
            const badge = demo.approvalStatus ? APPROVAL_BADGE[demo.approvalStatus] : null
            return (
              <div key={demo.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/leads/${demo.leadId}?tab=demo`}
                      className="text-sm font-semibold text-slate-100 hover:text-orange-300 transition-colors truncate block"
                    >
                      {demo.companyName}
                    </Link>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {[demo.contactName, demo.city].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {badge && (
                    <span className={cn('flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0', badge.cls)}>
                      <badge.Icon size={10} /> {badge.label}
                    </span>
                  )}
                </div>

                {/* Meta */}
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Monitor size={12} className="text-orange-400" />
                    {demo.demoVersion || 'Demo'}
                  </span>
                  {demo.developerName && (
                    <span className="flex items-center gap-1">
                      <Code2 size={12} className="text-slate-500" /> {demo.developerName}
                    </span>
                  )}
                  <span className="text-slate-500">{formatDate(demo.createdAt)}</span>
                </div>

                {/* URL */}
                <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5">
                  <a
                    href={ensureHttps(demo.tempUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 truncate flex-1 min-w-0"
                  >
                    <ExternalLink size={12} className="shrink-0" />
                    <span className="truncate">{demo.tempUrl.replace(/^https?:\/\//, '')}</span>
                  </a>
                  <CopyButton text={ensureHttps(demo.tempUrl)} />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto pt-1">
                  <a
                    href={ensureHttps(demo.tempUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    Open Demo <ArrowUpRight size={13} />
                  </a>
                  <Link
                    href={`/leads/${demo.leadId}?tab=demo`}
                    className="flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                  >
                    View Lead
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
