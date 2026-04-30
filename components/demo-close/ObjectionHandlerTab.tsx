'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const OBJECTIONS = [
  {
    q: '"Let me think about it."',
    a: "Totally fair — this is a big decision. Can I ask what specifically you'd like to think about? Is it the price, the timeline, or something about the site itself? If we can clear that up right now, great. If not, I'd rather give you 48 hours with a clear answer than leave it open-ended. What would help you decide?",
  },
  {
    q: '"It\'s too expensive."',
    a: "I understand. Let me put it differently — your current site has issues that are costing you customers every day. If even one extra customer comes per week from the new site, the website pays for itself in a few weeks. The token is a small commitment to get started — fully adjustable if you're not happy after delivery.",
  },
  {
    q: '"I need to discuss with my partner / family."',
    a: "Of course. Would it help if I sent a quick one-page summary of what we built and what it costs — something you can show them? I can have it in their inbox in 10 minutes. That way the conversation is based on facts, not memory of a Zoom call.",
  },
  {
    q: '"My current website is fine."',
    a: "I respect that — and it might be fine for today. But look at the performance numbers we showed — your site scores low on mobile speed. That means a large percentage of people who try to open it on their phone leave before it loads. That's not a design opinion, that's data. You're already paying for those lost visitors. The new site fixes that.",
  },
  {
    q: '"Can you give me a discount?"',
    a: "The token amount is already structured to be low-risk for you — it's a small commitment relative to the delivery. What I can do is include GMB optimisation at no extra charge if you confirm today. That alone is a significant add-on. Does that work?",
  },
  {
    q: '"I\'ll do it next month."',
    a: "I'll be honest — every month you wait is another month your competitor ranks above you. The work we've already done — the audit, the demo — is ready now. We can deliver the live site in 7 days. Starting next month means 5–6 more weeks of missed customer enquiries. Is there a specific reason next month works better?",
  },
  {
    q: '"How do I know this will actually work?"',
    a: "That's a fair question. The before/after numbers we showed are real measurements from tools like Google PageSpeed and Search Console — not promises. What we're fixing are proven ranking factors: mobile speed, schema markup, and local keyword coverage. These are the same things your top-ranking competitors have. We're not guessing — we're applying the same formula.",
  },
  {
    q: '"I want to get other quotes first."',
    a: "Totally reasonable. While you're comparing, keep in mind that most agencies will give you a proposal but no demo. We've already done the work — you can see exactly what you're getting before you pay a rupee more. That's the difference. We're not asking you to trust a promise; you're looking at the actual site.",
  },
]

export function ObjectionHandlerTab() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-amber-900/15 border border-amber-700/25 rounded-xl px-4 py-3 text-xs text-amber-300">
        <span className="mt-0.5 flex-shrink-0">⚠</span>
        Keep this tab open during the Zoom call. Click any objection to see the suggested response.
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Common Client Objections</p>
        <div className="space-y-2">
          {OBJECTIONS.map((obj, i) => {
            const isOpen = openIdx === i
            return (
              <div
                key={i}
                className={cn(
                  'bg-slate-900 border rounded-xl overflow-hidden transition-colors',
                  isOpen ? 'border-orange-700/40' : 'border-slate-800 hover:border-slate-700'
                )}
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <p className={cn('text-sm font-medium', isOpen ? 'text-orange-300' : 'text-slate-200')}>
                    {obj.q}
                  </p>
                  {isOpen
                    ? <ChevronDown size={15} className="text-orange-400 flex-shrink-0" />
                    : <ChevronRight size={15} className="text-slate-500 flex-shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <div className="border-t border-slate-800 pt-3">
                      <p className="text-xs text-slate-400 leading-relaxed">{obj.a}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
