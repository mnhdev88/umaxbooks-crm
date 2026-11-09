import type { SupabaseClient } from '@supabase/supabase-js'
import {
  GmailApiError, GmailMessage, extractBody, getMessage, getProfile, header,
  listHistory, listMessages, parseAddresses,
} from '@/lib/google/gmail'
import { isWorkspaceEmail, workspaceConfigError, workspaceDomains } from '@/lib/google/workspace'

/**
 * Gmail → CRM sync for Google Workspace mailboxes.
 *
 * Each agent mailbox is read incrementally via the Gmail history API (only what
 * changed since the stored historyId). Messages exchanged with a lead — agent → lead
 * (sent from Gmail) and lead → agent (replies) — are stored in `email_sends` on that
 * lead. Mail with non-leads is never fetched beyond its headers and never stored.
 *
 * De-duplication: CRM-sent mail already carries its Gmail id; everything else is keyed
 * on (lead_id, Message-ID header), which is identical across every mailbox it lands in.
 */

const BACKFILL_DAYS = Math.max(0, Number(process.env.GMAIL_SYNC_BACKFILL_DAYS ?? 14))
const MAX_HTML_BYTES = 300_000            // keep rows (and disk IO) bounded
const NOTIFY_WINDOW_MS = 24 * 3600_000    // don't notify about old replies found by backfill
const SKIP_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH', 'CHAT'])
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Message-ID']

interface Agent { id: string; email: string; full_name: string | null }

interface SyncState {
  user_id: string
  history_id: string | null
  backfill_after: string | null
  backfill_page_token: string | null
  last_synced_at: string | null
  total_imported: number
}

export interface MailboxResult {
  user_id: string
  mailbox: string
  imported: number
  error?: string
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

function isInternal(addr: string) {
  return workspaceDomains().includes(addr.split('@')[1] || '')
}

// ---------------------------------------------------------------------------

export async function syncAllMailboxes(
  service: SupabaseClient,
  opts: { userIds?: string[] } = {},
): Promise<{ ok: boolean; error?: string; mailboxes: MailboxResult[] }> {
  const configError = workspaceConfigError()
  if (configError) return { ok: false, error: configError, mailboxes: [] }

  let query = service.from('profiles').select('id, email, full_name')
  if (opts.userIds?.length) query = query.in('id', opts.userIds)
  const { data: profiles, error } = await query
  if (error) return { ok: false, error: error.message, mailboxes: [] }

  const agents = ((profiles || []) as Agent[]).filter(p => isWorkspaceEmail(p.email))
  if (!agents.length) return { ok: true, mailboxes: [] }

  const { data: states } = await service
    .from('gmail_sync_state')
    .select('user_id, history_id, backfill_after, backfill_page_token, last_synced_at, total_imported')
    .in('user_id', agents.map(a => a.id))
  const stateById = new Map(((states || []) as SyncState[]).map(s => [s.user_id, s]))

  const mailboxes = await mapLimit(agents, 3, agent => syncMailbox(service, agent, stateById.get(agent.id) || null))
  return { ok: true, mailboxes }
}

async function syncMailbox(service: SupabaseClient, agent: Agent, state: SyncState | null): Promise<MailboxResult> {
  const mailbox = agent.email.toLowerCase()
  try {
    let historyId = state?.history_id || null
    let backfillAfter = state?.backfill_after || null
    let backfillToken = state?.backfill_page_token || null
    const ids: string[] = []
    let fromHistory = false

    if (!historyId) {
      // First run for this mailbox: remember "now", then backfill recent mail
      historyId = (await getProfile(mailbox)).historyId
      backfillAfter = BACKFILL_DAYS > 0 ? new Date(Date.now() - BACKFILL_DAYS * 86400_000).toISOString() : null
      backfillToken = null
    } else {
      try {
        let pageToken: string | null = null
        let latest = historyId
        do {
          const page = await listHistory(mailbox, historyId, pageToken)
          for (const h of page.history || []) {
            for (const added of h.messagesAdded || []) {
              if (!(added.message.labelIds || []).some(l => SKIP_LABELS.has(l))) ids.push(added.message.id)
            }
          }
          latest = page.historyId || latest
          pageToken = page.nextPageToken || null
        } while (pageToken)
        historyId = latest
        fromHistory = true
      } catch (e) {
        // historyId too old (Gmail keeps ~1 week): restart from now and backfill the gap
        if (e instanceof GmailApiError && e.status === 404) {
          historyId = (await getProfile(mailbox)).historyId
          const since = state?.last_synced_at ? new Date(state.last_synced_at).getTime() - 3600_000 : Date.now() - 7 * 86400_000
          backfillAfter = new Date(since).toISOString()
          backfillToken = null
        } else {
          throw e
        }
      }
    }

    // One backfill page per run keeps each invocation short; later runs continue it
    if (backfillAfter) {
      const after = Math.floor(new Date(backfillAfter).getTime() / 1000)
      const page = await listMessages(mailbox, `after:${after} -in:drafts -in:spam -in:trash -in:chats`, backfillToken)
      ids.push(...(page.messages || []).map(m => m.id))
      backfillToken = page.nextPageToken || null
      if (!backfillToken) backfillAfter = null
    }

    const imported = await importMessages(service, agent, mailbox, [...new Set(ids)], { notify: fromHistory })

    await service.from('gmail_sync_state').upsert({
      user_id: agent.id,
      mailbox,
      history_id: historyId,
      backfill_after: backfillAfter,
      backfill_page_token: backfillToken,
      last_synced_at: new Date().toISOString(),
      last_imported: imported,
      total_imported: (state?.total_imported || 0) + imported,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    })
    return { user_id: agent.id, mailbox, imported }
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e).slice(0, 500)
    console.error(`[gmail-sync] ${mailbox}:`, message)
    // Keep the cursor as it was so the next run retries the same window
    await service.from('gmail_sync_state').upsert({
      user_id: agent.id,
      mailbox,
      history_id: state?.history_id ?? null,
      backfill_after: state?.backfill_after ?? null,
      backfill_page_token: state?.backfill_page_token ?? null,
      last_synced_at: state?.last_synced_at ?? null,
      total_imported: state?.total_imported ?? 0,
      last_error: message,
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return { user_id: agent.id, mailbox, imported: 0, error: message }
  }
}

// ---------------------------------------------------------------------------

interface Candidate {
  msg: GmailMessage
  direction: 'outbound' | 'inbound'
  counterparties: string[]
}

interface LeadMatch {
  lead_id: string
  matched_email: string
  assigned_agent_id: string | null
  company_name: string | null
  lead_name: string | null
  status: string | null
}

interface ImportedMeta {
  direction: 'outbound' | 'inbound'
  subject: string
  date: string
  lead: LeadMatch
  from: string
}

async function importMessages(
  service: SupabaseClient,
  agent: Agent,
  mailbox: string,
  ids: string[],
  opts: { notify: boolean },
): Promise<number> {
  if (!ids.length) return 0

  // Skip messages already stored from this mailbox (e.g. sent from the CRM)
  const { data: known } = await service.from('email_sends').select('gmail_message_id').in('gmail_message_id', ids)
  const knownIds = new Set((known || []).map((r: { gmail_message_id: string }) => r.gmail_message_id))
  const todo = ids.filter(id => !knownIds.has(id))
  if (!todo.length) return 0

  // 1. Headers only — cheap, and enough to decide whether a lead is involved
  const metas = await mapLimit(todo, 8, id =>
    getMessage(mailbox, id, 'metadata', METADATA_HEADERS).catch(e => {
      if (e instanceof GmailApiError && e.status === 404) return null // deleted since
      throw e
    }))

  const candidates: Candidate[] = []
  for (const msg of metas) {
    if (!msg || (msg.labelIds || []).some(l => SKIP_LABELS.has(l))) continue
    const from = parseAddresses(header(msg, 'From'))[0] || ''
    const outbound = (msg.labelIds || []).includes('SENT') || from === mailbox
    if (outbound) {
      const recipients = parseAddresses([header(msg, 'To'), header(msg, 'Cc'), header(msg, 'Bcc')].join(','))
        .filter(a => a !== mailbox && !isInternal(a))
      if (recipients.length) candidates.push({ msg, direction: 'outbound', counterparties: recipients })
    } else if (from && !isInternal(from)) {
      candidates.push({ msg, direction: 'inbound', counterparties: [from] })
    }
  }
  if (!candidates.length) return 0

  // 2. One lookup for every address in this batch
  const allAddrs = [...new Set(candidates.flatMap(c => c.counterparties))]
  const { data: matches, error: matchErr } = await service.rpc('match_leads_by_emails', { p_emails: allAddrs })
  if (matchErr) throw new Error(`Lead lookup failed: ${matchErr.message}`)

  const leadsByAddr = new Map<string, LeadMatch[]>()
  for (const m of (matches || []) as LeadMatch[]) {
    const list = leadsByAddr.get(m.matched_email) || []
    if (!list.some(x => x.lead_id === m.lead_id)) list.push(m)
    leadsByAddr.set(m.matched_email, list)
  }

  const relevant = candidates
    .map(c => {
      const leads = new Map<string, LeadMatch>()
      for (const a of c.counterparties) for (const l of leadsByAddr.get(a) || []) leads.set(l.lead_id, l)
      return { ...c, leads: [...leads.values()] }
    })
    .filter(c => c.leads.length)
  if (!relevant.length) return 0

  // 3. Full bodies only for messages that involve a lead
  const fulls = await mapLimit(relevant, 4, c => getMessage(mailbox, c.msg.id, 'full'))

  const rows: Record<string, unknown>[] = []
  const meta = new Map<string, ImportedMeta>()
  relevant.forEach((c, i) => {
    const full = fulls[i]
    const { html, attachments } = extractBody(full)
    const rfc822 = header(c.msg, 'Message-ID') || `<gmail-${c.msg.id}@${mailbox}>`
    const date = c.msg.internalDate ? new Date(Number(c.msg.internalDate)).toISOString() : new Date().toISOString()
    const subject = header(c.msg, 'Subject') || '(no subject)'
    const body = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html
    for (const lead of c.leads) {
      rows.push({
        lead_id: lead.lead_id,
        direction: c.direction,
        source: 'gmail',
        status: c.direction === 'inbound' ? 'received' : 'sent',
        sent_by: c.direction === 'outbound' ? agent.id : null,
        mailbox_user_id: agent.id,
        from_email: header(c.msg, 'From') || mailbox,
        to_email: header(c.msg, 'To') || mailbox,
        cc: header(c.msg, 'Cc') || null,
        bcc: header(c.msg, 'Bcc') || null,
        subject,
        html_body: body,
        attachments: attachments.map(name => ({ name })),
        sent_at: date,
        created_at: date,
        gmail_message_id: c.msg.id,
        gmail_thread_id: c.msg.threadId,
        rfc822_message_id: rfc822,
      })
      meta.set(`${lead.lead_id}|${rfc822}`, {
        direction: c.direction, subject, date, lead,
        from: parseAddresses(header(c.msg, 'From'))[0] || '',
      })
    }
  })

  // 4. Insert; rows already present (same lead + Message-ID) are skipped
  const { data: inserted, error: insErr } = await service
    .from('email_sends')
    .upsert(rows, { onConflict: 'lead_id,rfc822_message_id', ignoreDuplicates: true })
    .select('id, lead_id, rfc822_message_id')
  if (insErr) throw new Error(`Saving synced emails failed: ${insErr.message}`)

  const fresh = ((inserted || []) as { lead_id: string; rfc822_message_id: string }[])
    .map(r => meta.get(`${r.lead_id}|${r.rfc822_message_id}`))
    .filter((f): f is ImportedMeta => !!f)
  if (!fresh.length) return 0

  // 5. Side effects, mirroring CRM sends
  const activity = fresh.map(f => ({
    lead_id: f.lead.lead_id,
    // activity_logs.user_id is NOT NULL — replies are logged against the mailbox owner
    user_id: agent.id,
    action: f.direction === 'outbound' ? 'Email Sent from Gmail' : 'Email Reply Received',
    details: f.direction === 'outbound'
      ? `Subject: ${f.subject} · from ${mailbox}`
      : `From: ${f.from} · Subject: ${f.subject}`,
    created_at: f.date,
  }))
  const { error: actErr } = await service.from('activity_logs').insert(activity)
  if (actErr) console.error('[gmail-sync] activity log insert failed:', actErr.message)

  const contacted = [...new Set(fresh.filter(f => f.direction === 'outbound').map(f => f.lead.lead_id))]
  if (contacted.length) {
    await service.from('leads').update({ status: 'Contacted' }).in('id', contacted).eq('status', 'New')
  }

  if (opts.notify) {
    const cutoff = Date.now() - NOTIFY_WINDOW_MS
    const notifications = fresh
      .filter(f => f.direction === 'inbound' && new Date(f.date).getTime() >= cutoff)
      .map(f => ({
        user_id: f.lead.assigned_agent_id || agent.id,
        lead_id: f.lead.lead_id,
        title: `Reply from ${f.lead.company_name || f.lead.lead_name || f.from}`,
        message: `${f.from} replied: "${f.subject}"`,
        type: 'info',
      }))
    if (notifications.length) await service.from('notifications').insert(notifications)
  }

  return fresh.length
}
