import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GitCompare } from 'lucide-react'
import { BeforeAfterComparison, BeforeAfterMetric } from '@/types'
import { getPortalLeadId } from '@/lib/portal-context'

export default async function PortalBeforeAfterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  if (!leadId) {
    return (
      <div className="p-8 text-center text-slate-400">
        <GitCompare size={40} className="text-slate-700 mx-auto mb-3" />
        <p>Results will appear here once your project is complete.</p>
      </div>
    )
  }

  const [{ data: comparison }, { data: metrics }] = await Promise.all([
    supabase.from('before_after_comparisons')
      .select('*').eq('lead_id', leadId).single(),
    supabase.from('before_after_metrics')
      .select('*').eq('lead_id', leadId)
      .order('sort_order'),
  ])

  const comp    = comparison as BeforeAfterComparison | null
  const metList = (metrics ?? []) as BeforeAfterMetric[]

  if (!comp && metList.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-6">Your Results</h1>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <GitCompare size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">Results will appear here once your project is complete.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Your Results</h1>
        <p className="text-slate-400 text-sm">Before &amp; after your website transformation</p>
      </div>

      {/* Screenshot comparison */}
      {(comp?.before_screenshot_url || comp?.after_screenshot_url) && (
        <div className="grid grid-cols-2 gap-4">
          {comp.before_screenshot_url && (
            <div className="rounded-xl overflow-hidden border border-slate-700">
              <p className="text-xs text-slate-500 px-3 py-2 bg-slate-800/80">Before</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={comp.before_screenshot_url} alt="Before" className="w-full object-cover" />
            </div>
          )}
          {comp.after_screenshot_url && (
            <div className="rounded-xl overflow-hidden border border-orange-500/30">
              <p className="text-xs text-orange-400 px-3 py-2 bg-slate-800/80">After</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={comp.after_screenshot_url} alt="After" className="w-full object-cover" />
            </div>
          )}
        </div>
      )}

      {/* Developer summary */}
      {comp?.developer_summary && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-2">Summary from our team</p>
          <p className="text-slate-300 text-sm leading-relaxed">{comp.developer_summary}</p>
        </div>
      )}

      {/* Metrics table */}
      {metList.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Performance Metrics</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60">
                  <th scope="col" className="text-left px-4 py-3 text-slate-400 font-medium">Metric</th>
                  <th scope="col" className="text-left px-4 py-3 text-slate-400 font-medium">Before</th>
                  <th scope="col" className="text-left px-4 py-3 text-orange-400 font-medium">After</th>
                  <th scope="col" className="text-left px-4 py-3 text-slate-400 font-medium">Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {metList.map(m => (
                  <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{m.metric_name}</td>
                    <td className="px-4 py-3 text-slate-400">{m.before_value ?? '—'}</td>
                    <td className="px-4 py-3 text-green-400 font-semibold">{m.after_value ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{m.business_impact ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
