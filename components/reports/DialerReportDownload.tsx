'use client'
import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'

// Admin-only button that downloads the per-agent dialer-call CSV for whatever
// date range is currently selected on the Reports page (mirrors ReportsDateFilter).
export function DialerReportDownload() {
  const searchParams = useSearchParams()
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  const href = qs ? `/api/reports/dialer?${qs}` : '/api/reports/dialer'

  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
    >
      <Download size={14} aria-hidden="true" />
      Download dialer calls (CSV)
    </a>
  )
}
