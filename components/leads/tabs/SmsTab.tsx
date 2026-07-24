'use client'

import { MessageSquare } from 'lucide-react'
import { SmsConversation } from '@/components/sms/SmsConversation'

/**
 * Inline SMS conversation tab on the lead detail view (sits right after the Calls tab).
 * Renders the shared SmsConversation full-width so the whole text thread is visible at a
 * glance, without opening the quick-text modal.
 */
export function SmsTab({
  leadId,
  phone,
  altPhones,
  name,
}: {
  leadId: string
  phone?: string | null
  altPhones?: { value: string; label?: string }[] | null
  name?: string | null
}) {
  const primary = phone || altPhones?.[0]?.value || null

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
          <MessageSquare size={15} className="text-sky-400" />
          Text messages{name ? ` · ${name}` : ''}
        </h3>
        {primary && <span className="text-xs text-slate-500">{primary}</span>}
      </div>

      {primary ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
          <SmsConversation leadId={leadId} phone={phone} altPhones={altPhones} className="h-[560px]" />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 py-12 text-center text-sm text-slate-500">
          No phone number on file for this lead.
        </div>
      )}
    </div>
  )
}
