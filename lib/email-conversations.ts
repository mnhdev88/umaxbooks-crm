/**
 * Lead email conversations for the /emails inbox: email_sends rolled up to one summary
 * per lead (latest message wins). Covers CRM sends, mail synced from Gmail and lead
 * replies. Bodies are NOT loaded here — only the open thread fetches html_body.
 *
 * Scoping matches the Email Status page:
 *   admin / legacy agent → everything
 *   sales_manager        → leads their RLS shows (own + team), via an inner leads embed
 *   sales_agent          → leads assigned to them ∪ mail they sent / that sits in their mailbox
 * Shared by the page (SSR) and GET /api/email/conversations (the inbox poll).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Replies older than this with no read marker don't count as unread. */
export const UNREAD_BASELINE_MS = 7 * 24 * 3600_000

const PAGE = 1000
const MAX_ROWS = 5000

interface Row {
  id: string
  lead_id: string
  direction: 'outbound' | 'inbound'
  source: 'crm' | 'gmail'
  subject: string | null
  status: string
  sent_at: string | null
  created_at: string
  sent_by: string | null
  mailbox_user_id: string | null
  lead: {
    id: string
    name: string | null
    company_name: string | null
    email: string | null
    alt_emails: { value: string; label?: string }[] | null
    assigned_agent_id: string | null
  } | null
}

export interface EmailConversationSummary {
  leadId: string
  name: string | null
  company: string | null
  email: string | null
  altEmails: { value: string; label?: string }[] | null
  assignedAgentId: string | null
  /** Every CRM user who sent or received mail in this conversation. */
  agentIds: string[]
  lastSubject: string
  lastAt: string
  lastDirection: 'inbound' | 'outbound'
  lastSource: 'crm' | 'gmail'
  lastInboundAt: string | null
  messageCount: number
  /** Latest message is a lead reply — awaiting an answer. */
  needsReply: boolean
  /** Has a lead reply newer than this user's last read of the conversation. */
  unread: boolean
}

const COLS =
  'id, lead_id, direction, source, subject, status, sent_at, created_at, sent_by, mailbox_user_id, ' +
  'lead:leads!inner(id, name, company_name, email, alt_emails, assigned_agent_id)'

export async function fetchEmailConversations(
  supabase: SupabaseClient,
  opts: { userId: string; role: string },
): Promise<EmailConversationSummary[]> {
  type Query = ReturnType<typeof listQuery>
  const listQuery = () =>
    supabase
      .from('email_sends')
      .select(COLS)
      .neq('status', 'scheduled')
      .order('created_at', { ascending: false })

  // PostgREST caps each response at 1000 rows, so page through (newest first, up to
  // MAX_ROWS). List rows carry no bodies, so this stays light.
  const fetchAll = async (scope: (q: Query) => Query): Promise<Row[]> => {
    const out: Row[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await scope(listQuery()).range(from, from + PAGE - 1)
      if (error) { console.error('[email-conversations]', error); break }
      out.push(...((data as unknown as Row[]) || []))
      if (!data || data.length < PAGE) break
    }
    return out
  }

  let rows: Row[] = []
  if (opts.role === 'sales_agent') {
    // Two queries merged in memory: PostgREST can't OR a base-table filter with an
    // embedded-table filter in one call (see app/(dashboard)/email-status/page.tsx).
    const [mine, assigned] = await Promise.all([
      fetchAll(q => q.or(`sent_by.eq.${opts.userId},mailbox_user_id.eq.${opts.userId}`)),
      fetchAll(q => q.eq('lead.assigned_agent_id', opts.userId)),
    ])
    const byId = new Map<string, Row>()
    for (const r of [...mine, ...assigned]) byId.set(r.id, r)
    rows = [...byId.values()]
  } else {
    rows = await fetchAll(q => q)
  }

  const { data: reads } = await supabase
    .from('email_thread_reads')
    .select('lead_id, read_at')
    .eq('user_id', opts.userId)
  const readAt = new Map(((reads || []) as { lead_id: string; read_at: string }[]).map(r => [r.lead_id, r.read_at]))

  const when = (r: Row) => r.sent_at || r.created_at
  rows.sort((a, b) => Date.parse(when(b)) - Date.parse(when(a)))

  const byLead = new Map<string, EmailConversationSummary>()
  for (const r of rows) {
    const at = when(r)
    let c = byLead.get(r.lead_id)
    if (!c) {
      c = {
        leadId: r.lead_id,
        name: r.lead?.name ?? null,
        company: r.lead?.company_name ?? null,
        email: r.lead?.email ?? null,
        altEmails: r.lead?.alt_emails ?? null,
        assignedAgentId: r.lead?.assigned_agent_id ?? null,
        agentIds: [],
        lastSubject: r.subject || '(no subject)',
        lastAt: at,
        lastDirection: r.direction,
        lastSource: r.source,
        lastInboundAt: null,
        messageCount: 0,
        needsReply: r.direction === 'inbound',
        unread: false,
      }
      byLead.set(r.lead_id, c)
    }
    c.messageCount++
    if (r.direction === 'inbound' && !c.lastInboundAt) c.lastInboundAt = at
    for (const id of [r.sent_by, r.mailbox_user_id]) {
      if (id && !c.agentIds.includes(id)) c.agentIds.push(id)
    }
  }

  // Compare as times, not strings: Postgres and JS format offsets/fractions differently
  const baseline = Date.now() - UNREAD_BASELINE_MS
  for (const c of byLead.values()) {
    if (!c.lastInboundAt) continue
    const read = readAt.get(c.leadId)
    c.unread = Date.parse(c.lastInboundAt) > (read ? Date.parse(read) : baseline)
  }
  return [...byLead.values()]
}

/**
 * Whether this user may open a lead's email thread. Admins/agents: any lead. Sales
 * managers: leads their RLS shows. Sales agents: assigned leads or mail they took part in.
 */
export async function canViewEmailThread(
  supabase: SupabaseClient,
  opts: { userId: string; role: string; leadId: string },
): Promise<boolean> {
  if (opts.role === 'developer' || opts.role === 'client' || opts.role === 'seo_agent') return false
  const { data: lead } = await supabase.from('leads').select('id, assigned_agent_id').eq('id', opts.leadId).maybeSingle()
  if (!lead) return false
  if (opts.role !== 'sales_agent' || lead.assigned_agent_id === opts.userId) return true
  const { count } = await supabase
    .from('email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', opts.leadId)
    .or(`sent_by.eq.${opts.userId},mailbox_user_id.eq.${opts.userId}`)
  return (count || 0) > 0
}
