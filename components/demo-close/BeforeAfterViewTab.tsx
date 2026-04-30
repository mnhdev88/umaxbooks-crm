'use client'

interface BeforeAfterViewTabProps {
  comparison: any
  metrics: any[]
  lead: any
}

function buildCaption(metrics: any[], type: 'before' | 'after'): string {
  const vk = type === 'before' ? 'before_value' : 'after_value'
  const parts: string[] = []

  const speed = metrics.find(m => /pagespeed.*mobile/i.test(m.metric_name))
  if (speed?.[vk]) {
    const n = String(speed[vk]).match(/\d+/)?.[0]
    if (n) parts.push(`Speed: ${n}`)
  }

  const schema = metrics.find(m => /schema/i.test(m.metric_name))
  if (schema?.[vk]) {
    const v = String(schema[vk])
    parts.push(type === 'before'
      ? (v.toLowerCase() === 'none' ? 'No schema' : v.slice(0, 18))
      : 'Schema added')
  }

  const cta = metrics.find(m => /\bcta\b/i.test(m.metric_name))
  if (cta?.[vk]) {
    const v = String(cta[vk])
    parts.push(type === 'before'
      ? (/hidden/i.test(v) ? 'Hidden CTA' : v.slice(0, 18))
      : (/sticky/i.test(v) ? 'Sticky CTA' : v.slice(0, 18)))
  }

  return parts.join(' · ')
}

export function BeforeAfterViewTab({ comparison, metrics, lead }: BeforeAfterViewTabProps) {
  const beforeCaption = buildCaption(metrics, 'before')
  const afterCaption  = buildCaption(metrics, 'after')

  return (
    <div className="space-y-5">

      {/* Info banner */}
      <div className="flex items-start gap-2.5 bg-blue-900/15 border border-blue-700/25 rounded-xl px-4 py-3 text-xs text-blue-300">
        <span className="mt-0.5 flex-shrink-0 text-blue-400">ℹ</span>
        This data was prepared by the developer. Use these exact numbers during the Zoom call.
      </div>

      {/* Website visual comparison */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Website Visual Comparison</p>
        <div className="grid grid-cols-2 gap-3">

          {/* Before */}
          <div className="border border-red-900/30 rounded-xl overflow-hidden">
            <div className="bg-red-900/15 px-3 py-2 text-xs font-semibold text-red-400">
              Before — {lead?.website_url?.replace(/^https?:\/\//,'').replace(/\/$/,'') || 'old site'}
            </div>
            <div className="h-36 bg-slate-900">
              {comparison?.before_screenshot_url
                ? <img src={comparison.before_screenshot_url} alt="before" className="w-full h-full object-cover" />
                : (
                  <div className="w-full h-full p-3 flex flex-col gap-2">
                    <div className="h-4 bg-[#2a2a3a] rounded" />
                    <div className="flex-1 grid grid-cols-[1fr_2fr] gap-2">
                      <div className="bg-[#1e1e2e] rounded" />
                      <div className="space-y-1.5">
                        <div className="h-8 bg-gradient-to-br from-[#2a2040] to-[#1a1a2e] rounded flex items-center justify-center">
                          <span className="text-[7px] text-white/20">No clear CTA · Slow load</span>
                        </div>
                        {[0,1,2].map(i => <div key={i} className="h-1 bg-[#2a2a3a] rounded w-3/4" />)}
                      </div>
                    </div>
                    <div className="h-3 bg-[#1a1a2a] rounded" />
                  </div>
                )}
            </div>
            {beforeCaption && (
              <div className="px-3 py-2 bg-red-900/10 text-xs text-red-400/80">{beforeCaption}</div>
            )}
          </div>

          {/* After */}
          <div className="border border-green-900/30 rounded-xl overflow-hidden">
            <div className="bg-green-900/15 px-3 py-2 text-xs font-semibold text-green-400">
              After — New demo site
            </div>
            <div className="h-36 bg-slate-900">
              {comparison?.after_screenshot_url
                ? <img src={comparison.after_screenshot_url} alt="after" className="w-full h-full object-cover" />
                : (
                  <div className="w-full h-full p-3 flex flex-col gap-1.5">
                    <div className="h-5 bg-orange-500 rounded flex items-center justify-between px-2">
                      <div className="w-8 h-1.5 bg-white/70 rounded" />
                      <div className="w-12 h-2.5 bg-white/90 rounded-full" />
                    </div>
                    <div className="flex-1 bg-gradient-to-br from-[#1F3A93] to-[#2a4db7] rounded flex flex-col items-center justify-center gap-1.5">
                      <div className="w-1/2 h-1.5 bg-white/80 rounded" />
                      <div className="w-1/3 h-1 bg-white/40 rounded" />
                      <div className="w-16 h-3 bg-orange-500 rounded-full" />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[0,1,2].map(i => <div key={i} className="h-5 bg-slate-700 rounded" />)}
                    </div>
                  </div>
                )}
            </div>
            {afterCaption && (
              <div className="px-3 py-2 bg-green-900/10 text-xs text-green-400/80">{afterCaption}</div>
            )}
          </div>

        </div>
      </div>

      {/* Metrics table */}
      {metrics.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Metrics Table</p>
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900/80">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Metric</th>
                  <th className="text-left px-3 py-2.5 text-red-400 font-semibold uppercase tracking-wider text-[10px]">Before</th>
                  <th className="text-left px-3 py-2.5 text-green-400 font-semibold uppercase tracking-wider text-[10px]">After</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Business Impact</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={i} className="border-t border-slate-800 hover:bg-slate-900/40">
                    <td className="px-3 py-2.5 font-medium text-slate-200">{m.metric_name}</td>
                    <td className="px-3 py-2.5 text-red-400">{m.before_value || '—'}</td>
                    <td className="px-3 py-2.5 text-green-400 font-semibold">{m.after_value || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400">{m.business_impact || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Developer summary */}
      {comparison?.developer_summary && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Developer's Summary — Read to Client</p>
          <div className="border-l-2 border-orange-500 pl-4 bg-slate-900 rounded-r-xl py-3 pr-4">
            <p className="text-sm text-slate-400 italic leading-relaxed">"{comparison.developer_summary}"</p>
          </div>
        </div>
      )}

      {metrics.length === 0 && !comparison && (
        <div className="text-center py-10 text-slate-500 text-sm">
          No before/after data yet. The developer needs to add it in the Developer Queue module.
        </div>
      )}
    </div>
  )
}
