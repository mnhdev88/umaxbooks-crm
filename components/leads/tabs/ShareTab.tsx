'use client'

import { useEffect, useState } from 'react'
import { Lead, Profile } from '@/types'
import {
  Link2, Plus, Copy, Check, Eye, Ban, Unlock, MessageCircle, MessageSquare, ExternalLink, Loader2,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { SECTION_LABELS, SHARE_SECTIONS, type ShareSection } from '@/lib/share-link'

interface Props {
  lead: Lead
  profile: Profile
  userId: string
}

interface ShareLink {
  id: string
  token: string
  sections: ShareSection[]
  url: string
  state: 'active' | 'revoked' | 'expired'
  expires_at: string | null
  revoked_at: string | null
  view_count: number
  last_viewed_at: string | null
  locked_until: string | null
  created_at: string
}

const STATE_CLS = {
  active:  'bg-emerald-900/30 text-emerald-400 border-emerald-800/40',
  expired: 'bg-slate-800 text-slate-400 border-slate-700',
  revoked: 'bg-red-900/30 text-red-400 border-red-800/40',
} as const

/**
 * "Client Link" — generate the no-login /share/<token> page for this lead and
 * hand it to the client.
 *
 * The rep never sees a document URL here, only the share URL: the files
 * themselves are streamed through /api/public/share/<token>/file, so revoking
 * a link on this screen actually takes the documents away.
 */
export function ShareTab({ lead, profile }: Props) {
  const [links, setLinks]       = useState<ShareLink[]>([])
  const [accepted, setAccepted] = useState<string[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId]     = useState<string | null>(null)
  const [copied, setCopied]     = useState<string | null>(null)
  const [sms, setSms]           = useState<string | null>(null)
  const [sections, setSections] = useState<ShareSection[]>([...SHARE_SECTIONS])

  const canManage = ['admin', 'sales_agent', 'sales_manager'].includes(profile.role)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/lead-share?lead_id=${lead.id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load client links')
      setLinks(json.links || [])
      setAccepted(json.accepted_last4 || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load client links')
      setLinks([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [lead.id])

  function toggle(section: ShareSection) {
    setSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : SHARE_SECTIONS.filter(s => s === section || prev.includes(s)),
    )
  }

  async function create() {
    if (sections.length === 0 || creating) return
    setCreating(true)
    try {
      const res  = await fetch('/api/lead-share', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lead_id: lead.id, sections }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not create the link')
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not create the link')
    }
    setCreating(false)
  }

  async function act(link: ShareLink, action: 'revoke' | 'unlock') {
    if (action === 'revoke' && !window.confirm(
      'Revoke this link? It stops working immediately for the client — generate a new one if they still need access.',
    )) return

    setBusyId(link.id)
    try {
      const res  = await fetch('/api/lead-share', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: link.id, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'That did not work')
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'That did not work')
    }
    setBusyId(null)
  }

  async function copy(link: ShareLink) {
    await navigator.clipboard.writeText(link.url)
    setCopied(link.id)
    setTimeout(() => setCopied(null), 1500)
  }

  function smsText(link: ShareLink) {
    const what = link.sections.map(s => SECTION_LABELS[s].toLowerCase()).join(', ')
    return `Hi${lead.name ? ` ${lead.name}` : ''}, here's your ${what} from Noveliotech: ${link.url}\n`
      + `Open it with the last 4 digits of this phone number.`
  }

  /** Send the link straight into the existing SMS thread for this lead. */
  async function sendSms(link: ShareLink) {
    if (!lead.phone) return
    setSms(link.id)
    try {
      const res  = await fetch('/api/voice/twilio/sms/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leadId: lead.id, to: lead.phone, body: smsText(link) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not send the text')
      window.alert('Link texted to the client.')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not send the text')
    }
    setSms(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Client Link</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            One page the client opens with no login — proposal, agreement and SEO report.
          </p>
        </div>
        {accepted.length > 0 && (
          <p className="text-xs text-slate-400">
            Opens with the last 4 digits:{' '}
            {accepted.map(d => (
              <span key={d} className="font-mono font-semibold text-orange-400 ml-1">{d}</span>
            ))}
          </p>
        )}
      </div>

      {canManage && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-300">Include on the link</p>
          <div className="flex flex-wrap gap-2">
            {SHARE_SECTIONS.map(s => {
              const on = sections.includes(s)
              return (
                <button
                  key={s}
                  onClick={() => toggle(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    on
                      ? 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {on ? '✓ ' : ''}{SECTION_LABELS[s]}
                </button>
              )
            })}
          </div>
          <button
            onClick={create}
            disabled={sections.length === 0 || creating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Generate link
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : error ? (
        <div className="text-center py-10">
          <Link2 className="w-10 h-10 text-red-500/40 mx-auto mb-3" />
          <p className="text-red-400 text-sm mb-1">{error}</p>
          <button onClick={load} className="text-orange-400 hover:text-orange-300 text-sm font-medium">
            Try again
          </button>
        </div>
      ) : links.length === 0 ? (
        <div className="text-center py-10">
          <Link2 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No client link yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => {
            const locked = !!link.locked_until && Date.parse(link.locked_until) > Date.now()
            const busy   = busyId === link.id
            return (
              <div key={link.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border capitalize ${STATE_CLS[link.state]}`}>
                    {link.state}
                  </span>
                  {link.sections.map(s => (
                    <span key={s} className="text-[11px] px-2 py-0.5 rounded-md bg-slate-900 text-slate-400 border border-slate-700">
                      {SECTION_LABELS[s]}
                    </span>
                  ))}
                  {locked && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-900/30 text-amber-400 border border-amber-800/40">
                      Locked — too many wrong digits
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
                    <Eye size={12} />
                    {link.view_count} {link.view_count === 1 ? 'view' : 'views'}
                    {link.last_viewed_at && <span className="text-slate-500">· last {formatDate(link.last_viewed_at)}</span>}
                  </span>
                </div>

                <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                  <code className="text-xs text-slate-300 truncate flex-1">{link.url}</code>
                  <button
                    onClick={() => copy(link)}
                    title="Copy link"
                    className="text-slate-500 hover:text-orange-400 transition-colors"
                  >
                    {copied === link.id ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  </button>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the client's view"
                    className="text-slate-500 hover:text-orange-400 transition-colors"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {link.state === 'active' && canManage && (
                    <>
                      {lead.phone && (
                        <button
                          onClick={() => sendSms(link)}
                          disabled={sms === link.id}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {sms === link.id ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                          Text it
                        </button>
                      )}
                      {lead.whatsapp_number && (
                        <a
                          href={`https://wa.me/${lead.whatsapp_number.replace(/\D/g, '')}?text=${encodeURIComponent(smsText(link))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-emerald-400 text-xs font-medium rounded-lg transition-colors"
                        >
                          <MessageCircle size={12} /> WhatsApp
                        </a>
                      )}
                      {locked && (
                        <button
                          onClick={() => act(link, 'unlock')}
                          disabled={busy}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-amber-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Unlock size={12} /> Clear lockout
                        </button>
                      )}
                      <button
                        onClick={() => act(link, 'revoke')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-red-900/30 border border-slate-700 hover:border-red-800/50 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Revoke
                      </button>
                    </>
                  )}
                  <span className="ml-auto text-[11px] text-slate-500">
                    Created {formatDate(link.created_at)}
                    {link.state === 'active' && link.expires_at && ` · expires ${formatDate(link.expires_at)}`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
