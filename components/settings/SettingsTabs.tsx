'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, Users, PhoneOutgoing, Mail, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Horizontal tabs for the Settings page.
//
// WHY: the page had grown to thirteen stacked cards in one column — several screens of
// scrolling to reach Email Templates, with no way to link someone to a specific block.
// Worse, thirteen of the fourteen cards fetch on mount, so every visit fired thirteen
// parallel requests (including the 30-day caller_number_health RPC and two voice_calls
// scans) to render settings the admin probably wasn't there to change.
//
// Only the active tab's content is rendered. Inactive tabs exist as React elements but
// are never mounted, so their effects never run and their fetches never fire — the
// laziness is the point, not a side effect. The trade-off is that switching away
// unmounts a card: in-flight edits in an unsaved input are lost, and coming back
// refetches. Both are fine here (every card saves per-field or per-row, and a refetch
// is what you want after leaving a settings screen), but it is why tab content must
// stay self-contained.
//
// Tab lives in the URL (?tab=calls) via the native History API, which Next's router
// integrates with — see node_modules/next/dist/docs/01-app/01-getting-started/
// 04-linking-and-navigating.md, "Native History API". pushState rather than
// replaceState so Back steps through tabs; the popstate listener keeps state in sync
// when it does.

export interface SettingsTab {
  id: string
  label: string
  /** Rendered only while this tab is active. */
  content: ReactNode
}

/** Keyed here rather than passed in: icon components are functions, which a Server
 *  Component cannot hand across the boundary as props. */
const ICONS: Record<string, typeof Users> = {
  general: SlidersHorizontal,
  team: Users,
  calls: PhoneOutgoing,
  email: Mail,
  reports: BarChart3,
}

export function SettingsTabs({ tabs, initialTab }: { tabs: SettingsTab[]; initialTab?: string }) {
  const valid = (id: string | undefined | null) => (id && tabs.some(t => t.id === id) ? id : null)
  const [active, setActive] = useState(() => valid(initialTab) || tabs[0].id)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Back/forward between tabs. The URL is the source of truth on a popstate — reading
  // location directly rather than trusting the entry's state, since the first entry for
  // this page was written by the server navigation and carries no state of ours.
  useEffect(() => {
    function onPop() {
      const fromUrl = new URLSearchParams(window.location.search).get('tab')
      setActive(valid(fromUrl) || tabs[0].id)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs])

  function select(id: string) {
    if (id === active) return
    setActive(id)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', id)
    window.history.pushState(null, '', `?${params.toString()}`)
    // Long tabs leave you mid-page; a tab switch should start at the top of the new one.
    window.scrollTo({ top: 0, behavior: 'smooth' })
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  const current = tabs.find(t => t.id === active) || tabs[0]

  return (
    <div>
      {/* Sticky so the tab row stays reachable inside a long tab. bg-[#0E0B24]/80 is not
          an arbitrary pick: light mode is a list of manual !important overrides in
          globals.css, and that exact class already has one (→ rgba(255,255,255,0.95)).
          A new hex here would render a dark bar on the light theme. */}
      <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-slate-800 bg-[#0E0B24]/80 px-6 backdrop-blur">
        {/* Mobile: a select, matching LeadDetailTabs — five underlined tabs do not fit
            a phone without horizontal scrolling that nobody discovers. */}
        <div className="py-3 md:hidden">
          <select
            value={active}
            onChange={e => select(e.target.value)}
            aria-label="Settings section"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
          >
            {tabs.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div ref={scrollRef} className="hidden overflow-x-auto scrollbar-hide md:flex">
          {tabs.map(t => {
            const Icon = ICONS[t.id]
            const on = t.id === active
            return (
              <button
                key={t.id}
                data-tab={t.id}
                onClick={() => select(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-all',
                  on
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-6">{current.content}</div>
    </div>
  )
}
