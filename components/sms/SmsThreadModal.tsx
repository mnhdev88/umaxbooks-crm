'use client'

import { MessageSquare, X } from 'lucide-react'
import { SmsConversation } from './SmsConversation'

/**
 * Per-lead SMS conversation as a quick modal, opened from the "Text" button. Just modal
 * chrome (backdrop, header, close) around the shared SmsConversation — the same thread
 * that also renders inline in the lead's SMS tab.
 */
export function SmsThreadModal({
  leadId,
  phone,
  altPhones,
  name,
  onClose,
}: {
  leadId: string
  phone?: string | null
  altPhones?: { value: string; label?: string }[] | null
  name?: string | null
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Text this lead"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] max-h-[640px] w-full max-w-md flex-col rounded-2xl border border-slate-700 bg-[#0E0B24] shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <MessageSquare size={14} className="text-sky-400" />
              Text {name || 'lead'}
            </p>
            <p className="truncate text-xs text-slate-400">
              {phone || altPhones?.[0]?.value || 'No number on file'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <SmsConversation leadId={leadId} phone={phone} altPhones={altPhones} className="flex-1 min-h-0" />
      </div>
    </div>
  )
}
