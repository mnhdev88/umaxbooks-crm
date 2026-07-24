/**
 * Roll sms_messages up into one summary per lead (latest message wins) for the SMS inbox.
 *
 * Shared by the /sms page (initial SSR render) and GET /api/voice/twilio/sms/conversations
 * (the inbox's 15s poll) so both apply identical scoping. Sales agents see only leads
 * assigned to them — scoped through an inner-joined leads embed on assigned_agent_id, NOT
 * a pre-fetched .in(...) id list (which builds an over-long URL the gateway rejects; see
 * the AI Calls page for the same pattern). Everyone else sees all lead conversations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Shape of one sms_messages row with its embedded lead (untyped client → declared here). */
interface SmsRow {
  lead_id: string | null
  direction: string
  body: string | null
  num_media: number | null
  created_at: string
  lead: {
    id: string
    name: string | null
    company_name: string | null
    phone: string | null
    alt_phones: { value: string; label?: string }[] | null
    assigned_agent_id: string | null
  } | null
}

export interface SmsConversationSummary {
  leadId: string
  name: string | null
  company: string | null
  phone: string | null
  altPhones: { value: string; label?: string }[] | null
  lastBody: string
  lastAt: string
  lastDirection: 'inbound' | 'outbound'
  /** Latest message is an inbound reply — flags a conversation awaiting an answer. */
  needsReply: boolean
}

export async function fetchSmsConversations(
  supabase: SupabaseClient,
  opts: { userId: string; role: string }
): Promise<SmsConversationSummary[]> {
  const isSalesAgent = opts.role === 'sales_agent'

  let query = supabase
    .from('sms_messages')
    .select(
      'lead_id, direction, body, num_media, created_at, ' +
        'lead:leads!inner(id, name, company_name, phone, alt_phones, assigned_agent_id)'
    )
    // Newest first so the first row seen for each lead is that lead's latest message.
    .order('created_at', { ascending: false })
    .limit(1000)

  if (isSalesAgent) query = query.eq('lead.assigned_agent_id', opts.userId)

  const { data, error } = await query
  if (error) {
    console.error('[sms-conversations] query failed', error)
    return []
  }

  // Map preserves insertion order, and we insert each lead on its newest message, so the
  // result comes out already sorted by most-recent activity.
  const seen = new Map<string, SmsConversationSummary>()
  for (const row of ((data || []) as unknown) as SmsRow[]) {
    const leadId = row.lead_id
    if (!leadId || seen.has(leadId)) continue
    const lead = row.lead
    seen.set(leadId, {
      leadId,
      name: lead?.name ?? null,
      company: lead?.company_name ?? null,
      phone: lead?.phone ?? null,
      altPhones: lead?.alt_phones ?? null,
      lastBody: row.body || (row.num_media ? `[${row.num_media} attachment(s)]` : ''),
      lastAt: row.created_at,
      lastDirection: row.direction === 'inbound' ? 'inbound' : 'outbound',
      needsReply: row.direction === 'inbound',
    })
  }

  return [...seen.values()]
}
