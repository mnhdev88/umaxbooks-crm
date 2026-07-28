'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, MessageSquareOff } from 'lucide-react'
import { POPUP_PREF_KEY, popupsEnabled } from './NotificationToaster'

/**
 * Per-browser opt-out for the 10-second notification popups.
 *
 * Stored in localStorage, like the theme preference — there's no per-user
 * settings table in this app, and adding one for a single boolean isn't worth a
 * migration. The trade-off is that turning popups off on a laptop doesn't carry
 * to a phone, which is stated in the copy so it isn't a surprise.
 */
export function PopupSettings() {
  // Start null so the server render and first client render agree; localStorage
  // isn't readable until after mount.
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => { setEnabled(popupsEnabled()) }, [])

  function toggle() {
    const next = !enabled
    setEnabled(next)
    try {
      localStorage.setItem(POPUP_PREF_KEY, next ? 'on' : 'off')
    } catch { /* private mode — the toggle just won't persist */ }
  }

  if (enabled === null) return null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 mb-6 rounded-xl bg-slate-800/50 border border-slate-700">
      <div className="flex items-center gap-3 min-w-0">
        {enabled ? (
          <MessageSquare size={16} className="text-orange-400 flex-shrink-0" aria-hidden="true" />
        ) : (
          <MessageSquareOff size={16} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">Popup alerts</p>
          <p className="text-xs text-slate-400">
            {enabled
              ? 'New notifications appear for 10 seconds while you’re using the CRM. This browser only.'
              : 'Popups are off in this browser. Notifications still reach the bell.'}
          </p>
        </div>
      </div>
      <button
        onClick={toggle}
        aria-pressed={enabled}
        className={
          enabled
            ? 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex-shrink-0'
            : 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors flex-shrink-0'
        }
      >
        {enabled ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}
