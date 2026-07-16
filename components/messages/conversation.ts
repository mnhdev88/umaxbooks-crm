import { ChatContact, ChatConversation } from '@/types'

// Every column the chat UI reads off a message. Shared so the channel view, the
// thread pane and the floating window can never drift apart on what they select.
//
// MUST stay a single string literal: supabase-js infers the result shape from
// the literal type of this string. Splitting it with `+` widens the type to
// plain `string`, the select parser gives up, and every `.select(MESSAGE_COLUMNS)`
// silently resolves to GenericStringError instead of a row.
export const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size, mentions, parent_message_id, reply_count'

// Shared conversation-shaping helpers.
//
// Both the /messages page and the floating widget build their conversation list
// from the same three queries, and both used to resolve "the other person" with
// a last-write-wins loop. That is fine for a DM and wrong for a team channel
// (082), where it silently picks whichever member happened to come last — so a
// channel would appear in the list wearing a random agent's name. These helpers
// are the single place that knows the difference.

export interface ConversationRow {
  id: string
  is_group: boolean
  title: string | null
  team_manager_id?: string | null
  last_message_at: string
  created_at: string
}

export interface MemberRow {
  conversation_id: string
  user_id: string
  profile: ChatContact | null
}

export interface RecentMessageRow {
  conversation_id: string
  body: string | null
  created_at: string
  sender_id: string
  attachment_name: string | null
  attachment_path: string | null
  parent_message_id?: string | null
}

// Preview text for the conversation list: body, else "📎 <filename>".
export function messagePreview(m: {
  body?: string | null
  attachment_name?: string | null
  attachment_path?: string | null
}): string | null {
  if (m.body) return m.body
  if (m.attachment_path) return `📎 ${m.attachment_name ?? 'Attachment'}`
  return null
}

// What to call a conversation in a list or header.
export function conversationName(c: ChatConversation): string {
  if (c.is_group) return c.title ?? 'Team'
  return c.other?.full_name ?? 'Unknown'
}

// Group members by conversation, keeping everyone (not just "the other one"),
// so a channel header can show a real member count.
export function membersByConversation(rows: MemberRow[]): Map<string, ChatContact[]> {
  const out = new Map<string, ChatContact[]>()
  for (const r of rows) {
    if (!r.profile) continue
    const list = out.get(r.conversation_id)
    if (list) list.push(r.profile)
    else out.set(r.conversation_id, [r.profile])
  }
  return out
}

// Assemble the conversation list from the raw query rows.
//
// Note the `parent_message_id` filter on previews: a thread reply must not
// become the channel's preview line, because the channel view does not show
// replies at all — the list would advertise a message you cannot see there.
export function buildConversations(
  userId: string,
  convs: ConversationRow[],
  members: MemberRow[],
  recent: RecentMessageRow[],
  lastReadById: Map<string, string | null>,
): ChatConversation[] {
  const byConv = membersByConversation(members)

  const lastByConv = new Map<string, RecentMessageRow>()
  for (const m of recent) {
    if (m.parent_message_id) continue
    if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m)
  }

  return convs
    .map((c): ChatConversation => {
      const all = byConv.get(c.id) ?? []
      const last = lastByConv.get(c.id)
      const lastRead = lastReadById.get(c.id)
      return {
        id: c.id,
        is_group: c.is_group,
        title: c.title,
        team_manager_id: c.team_manager_id ?? null,
        last_message_at: c.last_message_at,
        created_at: c.created_at,
        // Only a DM has a meaningful "other person".
        other: c.is_group ? null : (all.find((p) => p.id !== userId) ?? null),
        members: all,
        last_message: last ? messagePreview(last) : null,
        unread:
          !!last &&
          last.sender_id !== userId &&
          (!lastRead || new Date(last.created_at) > new Date(lastRead)),
      }
    })
    .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at))
}

// Team channels first, then everything else by recency. Mirrors Slack's
// channels-above-DMs grouping without needing a separate section header.
export function sortConversations(list: ChatConversation[]): ChatConversation[] {
  return [...list].sort((a, b) => {
    if (a.is_group !== b.is_group) return a.is_group ? -1 : 1
    return +new Date(b.last_message_at) - +new Date(a.last_message_at)
  })
}
