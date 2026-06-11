'use client'
import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'

// Downloads one agent's performance KPIs as CSV for whatever date range is
// currently selected on the profile page (mirrors ReportsDateFilter's from/to).
export function AgentPerformanceDownload({ agentId }: { agentId: string }) {
  const searchParams = useSearchParams()
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const params = new URLSearchParams({ agent: agentId })
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  return (
    <a
      href={`/api/reports/agent-performance?${params.toString()}`}
      download
      className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors shrink-0"
    >
      <Download size={14} aria-hidden="true" />
      Download report (CSV)
    </a>
  )
}
