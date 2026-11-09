'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, AlertCircle, Loader2, Mail } from 'lucide-react'

interface MailboxStatus {
  user_id: string
  name: string | null
  email: string
  last_synced_at?: string | null
  last_imported?: number
  total_imported?: number
  last_error?: string | null
  last_error_at?: string | null
  backfill_after?: string | null
}

interface Status {
  configured: boolean
  config_error: string | null
  service_account: string | null
  domains: string[]
  mailboxes: MailboxStatus[]
}

function ago(iso?: string | null) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? `${hrs} h ago` : new Date(iso).toLocaleDateString()
}

export function GmailSyncSetting() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  async function load() {
    const res = await fetch('/api/gmail/status')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setLoadError(data.error || 'Failed to load'); return }
    setLoadError(null)
    setStatus(data)
  }

  useEffect(() => { load() }, [])

  async function syncNow() {
    setSyncing(true)
    setSyncMsg(null)
    const res = await fetch('/api/cron/gmail-sync', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setSyncing(false)
    if (!res.ok) {
      setSyncMsg({ ok: false, msg: data.error || 'Sync failed' })
    } else {
      const failed = data.failed?.length || 0
      setSyncMsg({
        ok: failed === 0,
        msg: `Synced ${data.mailboxes} mailbox${data.mailboxes === 1 ? '' : 'es'} · ${data.imported} new email${data.imported === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`,
      })
    }
    load()
  }

  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-slate-100 font-semibold text-lg">Gmail Sync (Google Workspace)</h2>
          <p className="text-slate-400 text-sm mt-1">
            Emails agents send to leads from Gmail, and lead replies, appear on the lead automatically (every 5 minutes).
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing || !status?.configured}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}
      {!status && !loadError && (
        <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      )}

      {status && !status.configured && (
        <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Not set up yet: {status.config_error}. Follow docs/GMAIL_WORKSPACE_SETUP.md, then redeploy.
        </div>
      )}

      {status?.configured && (
        <>
          <p className="text-xs text-slate-500 mb-3">
            Service account <span className="font-mono text-slate-400">{status.service_account}</span> · Domain{status.domains.length > 1 ? 's' : ''}: {status.domains.join(', ')}
          </p>

          {syncMsg && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border mb-3 ${syncMsg.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-amber-400 bg-amber-400/10 border-amber-400/20'}`}>
              {syncMsg.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {syncMsg.msg}
            </div>
          )}

          {status.mailboxes.length === 0 ? (
            <p className="text-sm text-slate-400">No CRM users have an email on {status.domains.join(', ')}.</p>
          ) : (
            <div className="space-y-2">
              {status.mailboxes.map(m => (
                <div key={m.user_id} className="flex items-start justify-between gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                  <div className="flex items-start gap-3 min-w-0">
                    <Mail className={`w-4 h-4 mt-0.5 shrink-0 ${m.last_error ? 'text-red-400' : m.last_synced_at ? 'text-green-400' : 'text-slate-500'}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-100 truncate">{m.name || m.email}</p>
                      <p className="text-xs text-slate-400 truncate">{m.email}</p>
                      {m.last_error && (
                        <p className="text-xs text-red-400 mt-1 break-words">{m.last_error}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs text-slate-400">
                    <p>Synced {ago(m.last_synced_at)}</p>
                    <p className="text-slate-500">
                      {m.total_imported ?? 0} imported{m.backfill_after ? ' · catching up' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
