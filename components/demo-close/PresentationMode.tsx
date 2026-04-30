'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { X, ChevronLeft, ChevronRight, CheckCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface PresentationModeProps {
  isOpen: boolean
  onClose: () => void
  lead: any
  comparison: any
  metrics: any[]
  appointment: any
}

const TOTAL = 4

function SiteAfterMockup() {
  return (
    <div className="w-full h-full p-2 flex flex-col gap-1.5">
      <div className="h-7 bg-orange-500 rounded flex items-center justify-between px-3">
        <div className="w-12 h-2 bg-white/70 rounded" />
        <div className="w-16 h-3.5 bg-white/90 rounded-full" />
      </div>
      <div className="flex-1 bg-gradient-to-br from-[#1F3A93] to-[#2a4db7] rounded flex flex-col items-center justify-center gap-2 py-2">
        <div className="w-3/5 h-2 bg-white/80 rounded" />
        <div className="w-2/5 h-1.5 bg-white/40 rounded" />
        <div className="w-20 h-4 bg-orange-500 rounded-full mt-1" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[0,1,2].map(i => <div key={i} className="h-8 bg-slate-700 border border-slate-600 rounded" />)}
      </div>
      <div className="h-4 bg-[#1F3A93] rounded opacity-80" />
    </div>
  )
}

function SiteBeforeMockup() {
  return (
    <div className="w-full h-full p-2 flex flex-col gap-1.5">
      <div className="h-5 bg-[#2a2a3a] rounded flex items-center gap-1 px-2">
        {['bg-red-400','bg-yellow-400','bg-green-400'].map(c => <div key={c} className={`w-1.5 h-1.5 rounded-full ${c}`} />)}
      </div>
      <div className="flex-1 grid grid-cols-[1fr_2fr] gap-1.5">
        <div className="bg-[#1e1e2e] rounded" />
        <div className="flex flex-col gap-1.5">
          <div className="flex-1 bg-gradient-to-br from-[#2a2040] to-[#1a1a2e] rounded flex items-center justify-center">
            <span className="text-[8px] text-white/20">No clear CTA · Slow load</span>
          </div>
          {[0,1,2].map(i => <div key={i} className={`h-1 bg-[#2a2a3a] rounded ${i===1?'w-1/2':i===2?'w-3/4':'w-4/5'}`} />)}
        </div>
      </div>
      <div className="h-3 bg-[#1a1a2a] rounded" />
    </div>
  )
}

export function PresentationMode({ isOpen, onClose, lead, comparison, metrics, appointment }: PresentationModeProps) {
  const [current, setCurrent] = useState(0)

  if (!isOpen) return null

  function go(n: number) { setCurrent(Math.max(0, Math.min(n, TOTAL - 1))) }
  function next() { if (current === TOTAL - 1) { onClose(); return } go(current + 1) }
  function prev() { go(current - 1) }

  const impactData: Record<string, string> = (() => {
    try { return JSON.parse(comparison?.impact_data || '{}') } catch { return {} }
  })()

  const demoUrl = lead?.demos?.[0]?.temp_url

  const IMPACT_DEFAULTS = [
    { key: 'visibility', label: 'More Search Visibility',     num: impactData.visibility || '+40%' },
    { key: 'traffic',   label: 'Keyword Visibility',          num: impactData.traffic   || '3×' },
    { key: 'conversions',label: 'GMB Ranking Potential',      num: impactData.conversions|| 'Top 3' },
    { key: 'authority', label: 'Delivery Timeline',           num: impactData.authority  || '7 days' },
  ]

  return (
    <div className="fixed inset-0 bg-[#0e1525] z-[500] flex flex-col">
      {/* Topbar */}
      <div className="bg-[#0a1628] border-b border-slate-800 px-6 h-14 flex items-center justify-between flex-shrink-0">
        <p className="text-sm font-semibold text-slate-100">
          {lead?.company_name} — Demo Presentation
        </p>
        <div className="flex items-center gap-4">
          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <>
                {i > 0 && <div key={`line-${i}`} className="w-5 h-0.5 bg-slate-700" />}
                <button
                  key={i}
                  onClick={() => go(i)}
                  className={cn(
                    'w-7 h-7 rounded-full text-xs font-bold border-2 transition-all',
                    i < current  ? 'bg-green-900/30 border-green-500 text-green-300'
                    : i === current ? 'bg-orange-900/30 border-orange-500 text-orange-300'
                    : 'bg-slate-800 border-slate-600 text-slate-500'
                  )}
                >
                  {i < current ? '✓' : i + 1}
                </button>
              </>
            ))}
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            <X size={12} /> Exit Presentation
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
        <div className="w-full max-w-3xl">

          {/* Slide 0: Intro */}
          {current === 0 && (
            <div className="bg-[#0a1628] border border-slate-800 rounded-2xl p-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Introduction</p>
              <h2 className="text-2xl font-bold text-slate-100 mb-3 leading-tight">
                {lead?.name?.split(' ')[0] ? `${lead.name.split(' ')[0]}, ` : ''}here's what we found — and what we built.
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                We ran a full SEO and performance audit on your existing website. Then our team built a demo version that fixes the top issues. This call is to walk you through exactly what changed and why it matters for your business.
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { val: 'FREE',   sub: 'This audit & demo. No obligation.', cls: 'text-amber-400' },
                  { val: '7 days', sub: 'Delivery after you say yes.',        cls: 'text-teal-400' },
                  { val: '100%',   sub: 'Yours if you\'re not happy — refund.', cls: 'text-orange-400' },
                ].map(c => (
                  <div key={c.val} className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                    <p className={cn('text-2xl font-bold mb-1', c.cls)}>{c.val}</p>
                    <p className="text-xs text-slate-500">{c.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slide 1: Before/After */}
          {current === 1 && (
            <div className="bg-[#0a1628] border border-slate-800 rounded-2xl p-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Before vs After</p>
              <h2 className="text-2xl font-bold text-slate-100 mb-2">Your old site vs the new demo</h2>
              <p className="text-slate-400 text-sm mb-6">Same business. Very different first impression — and very different Google ranking.</p>
              <div className="grid grid-cols-2 gap-4">
                {/* Before */}
                <div className="border border-red-900/40 rounded-xl overflow-hidden">
                  <div className="bg-red-900/20 px-3 py-2 text-xs font-semibold text-red-400">
                    Before — {lead?.website_url?.replace(/^https?:\/\//,'') || 'old site'}
                  </div>
                  <div className="h-40 bg-slate-900">
                    {comparison?.before_screenshot_url
                      ? <img src={comparison.before_screenshot_url} alt="before" className="w-full h-full object-cover" />
                      : <SiteBeforeMockup />}
                  </div>
                </div>
                {/* After */}
                <div className="border border-green-900/40 rounded-xl overflow-hidden">
                  <div className="bg-green-900/20 px-3 py-2 text-xs font-semibold text-green-400">
                    After — New demo site
                  </div>
                  <div className="h-40 bg-slate-900">
                    {comparison?.after_screenshot_url
                      ? <img src={comparison.after_screenshot_url} alt="after" className="w-full h-full object-cover" />
                      : <SiteAfterMockup />}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Slide 2: Metrics */}
          {current === 2 && (
            <div className="bg-[#0a1628] border border-slate-800 rounded-2xl p-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Performance Numbers</p>
              <h2 className="text-2xl font-bold text-slate-100 mb-2">Every number that matters — improved.</h2>
              <p className="text-slate-400 text-sm mb-6">These aren't design changes. These are ranking and revenue changes.</p>
              {metrics.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {metrics.slice(0, 6).map((m, i) => (
                    <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                      <p className="text-xs text-red-400 mb-1">{m.before_value || '—'}</p>
                      <p className="text-lg">↓</p>
                      <p className="text-base font-bold text-green-400">{m.after_value || '—'}</p>
                      <p className="text-xs text-slate-500 mt-1">{m.metric_name}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500 text-sm">No metrics data available. Add metrics in the Before/After tab.</div>
              )}
            </div>
          )}

          {/* Slide 3: Impact + Demo URL */}
          {current === 3 && (
            <div className="bg-[#0a1628] border border-slate-800 rounded-2xl p-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">What This Means for Your Business</p>
              <h2 className="text-2xl font-bold text-slate-100 mb-2">More visibility. More enquiries. More revenue.</h2>
              <p className="text-slate-400 text-sm mb-5">The numbers above translate directly into customers you're currently losing to competitors.</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {IMPACT_DEFAULTS.map(c => (
                  <div key={c.key} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <p className="text-2xl font-bold text-green-400 mb-1">{c.num}</p>
                    <p className="text-sm font-semibold text-slate-200">{c.label}</p>
                  </div>
                ))}
              </div>
              {demoUrl && (
                <div className="border border-slate-700 rounded-xl overflow-hidden">
                  <div className="bg-slate-800 px-3 py-2 flex items-center gap-2">
                    {['bg-red-400','bg-yellow-400','bg-green-400'].map(c => <div key={c} className={`w-2 h-2 rounded-full ${c}`} />)}
                    <span className="flex-1 bg-slate-700 rounded px-2 py-0.5 font-mono text-xs text-teal-400">{demoUrl}</span>
                    <a href={demoUrl} target="_blank" rel="noreferrer"
                      className="text-xs bg-teal-900/30 text-teal-300 border border-teal-700/30 px-2 py-1 rounded flex items-center gap-1">
                      Open <ExternalLink size={10} />
                    </a>
                  </div>
                  <div className="h-28 bg-slate-900">
                    <SiteAfterMockup />
                  </div>
                </div>
              )}
              {comparison?.developer_summary && (
                <div className="mt-4 border-l-2 border-orange-500 pl-3 text-sm text-slate-400 italic">
                  "{comparison.developer_summary}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="bg-[#0a1628] border-t border-slate-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <p className="text-xs text-slate-500">Slide {current + 1} of {TOTAL}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={prev} disabled={current === 0}>
            <ChevronLeft size={13} /> Previous
          </Button>
          <Button size="sm" onClick={next}>
            {current === TOTAL - 1 ? 'Finish Presentation' : 'Next'}
            {current < TOTAL - 1 && <ChevronRight size={13} />}
          </Button>
        </div>
      </div>
    </div>
  )
}
