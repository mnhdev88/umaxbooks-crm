'use client'

import { useState, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Send, AlertCircle } from 'lucide-react'

interface Props {
  leadId: string
  clientId: string
  companyName?: string
}

type RequestType = 'revision' | 'bug' | 'content' | 'other'

const TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: 'revision', label: 'Revision Request' },
  { value: 'bug',      label: 'Bug Report' },
  { value: 'content',  label: 'Content Update' },
  { value: 'other',    label: 'Other' },
]

export function SupportRequestForm({ leadId, clientId, companyName = '' }: Props) {
  const [title, setTitle]     = useState('')
  const [description, setDesc] = useState('')
  const [type, setType]       = useState<RequestType>('revision')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const typeId  = useId()
  const titleId = useId()
  const descId  = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('Please enter a title for your request.')
      return
    }
    setLoading(true)

    const { error: insertError } = await supabase.from('support_requests').insert({
      lead_id:     leadId,
      client_id:   clientId,
      title:       title.trim(),
      description: description.trim() || null,
      type,
    })

    setLoading(false)
    if (insertError) {
      setError('Could not submit your request. Please try again or email us directly.')
      return
    }
    {
      // Notify admins + sales agents in background (non-blocking)
      fetch('/api/support/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, ticket_title: title.trim(), company_name: companyName }),
      }).catch(() => {})

      setTitle('')
      setDesc('')
      setType('revision')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      router.refresh()
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4"
    >
      <p className="text-sm font-semibold text-slate-300">Submit a New Request</p>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-900/30 border border-red-700 px-3 py-2.5 text-sm text-red-300">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <div>
        <label htmlFor={typeId} className="block text-xs text-slate-400 mb-1.5">Request Type</label>
        <select
          id={typeId}
          value={type}
          onChange={e => setType(e.target.value as RequestType)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm
                     text-white focus:outline-none focus:border-orange-500"
        >
          {TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={titleId} className="block text-xs text-slate-400 mb-1.5">Title</label>
        <input
          id={titleId}
          required
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Update phone number on contact page"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm
                     text-white placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
        />
      </div>

      <div>
        <label htmlFor={descId} className="block text-xs text-slate-400 mb-1.5">Details <span className="text-slate-600">(optional)</span></label>
        <textarea
          id={descId}
          value={description}
          onChange={e => setDesc(e.target.value)}
          rows={3}
          placeholder="Describe exactly what needs to change..."
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm
                     text-white placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="inline-flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600
                     disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm
                     rounded-lg font-medium transition-colors"
        >
          <Send size={14} />
          {loading ? 'Submitting...' : 'Submit Request'}
        </button>
        {success && (
          <p className="text-green-400 text-sm">Request submitted successfully.</p>
        )}
      </div>
    </form>
  )
}
