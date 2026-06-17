import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, ChatContact, ChatConversation } from '@/types'
import { MessagesClient } from '@/components/messages/MessagesClient'

export const dynamic = 'force-dynamic'

export default async function MessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  // Staff-only feature; clients live in the separate portal.
  if (profile.role === 'client') redirect('/')

  // Everyone you can DM: all staff except yourself.
  const { data: contactsRaw } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, last_seen_at')
    .neq('role', 'client')
    .neq('id', user.id)
    .order('full_name')
  const contacts = (contactsRaw ?? []) as ChatContact[]

  // My conversations (+ when I last read each).
  const { data: myParts } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)

  const convIds = (myParts ?? []).map((p) => p.conversation_id)
  const lastReadById = new Map((myParts ?? []).map((p) => [p.conversation_id, p.last_read_at]))

  let conversations: ChatConversation[] = []

  if (convIds.length > 0) {
    const [{ data: convs }, { data: members }, { data: recent }] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, is_group, title, last_message_at, created_at')
        .in('id', convIds),
      supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)')
        .in('conversation_id', convIds),
      // Newest-first; enough to derive a preview + unread flag per thread.
      supabase
        .from('messages')
        .select('conversation_id, body, created_at, sender_id, attachment_name, attachment_path')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(400),
    ])

    const otherByConv = new Map<string, ChatContact>()
    for (const m of members ?? []) {
      if (m.user_id !== user.id && m.profile) {
        otherByConv.set(m.conversation_id, m.profile as unknown as ChatContact)
      }
    }

    type RecentMsg = { conversation_id: string; body: string | null; created_at: string; sender_id: string; attachment_name: string | null; attachment_path: string | null }
    const lastMsgByConv = new Map<string, RecentMsg>()
    for (const msg of (recent ?? []) as RecentMsg[]) {
      if (!lastMsgByConv.has(msg.conversation_id)) lastMsgByConv.set(msg.conversation_id, msg)
    }
    const preview = (m: RecentMsg) => m.body ?? (m.attachment_path ? `📎 ${m.attachment_name ?? 'Attachment'}` : null)

    conversations = (convs ?? [])
      .map((c): ChatConversation => {
        const last = lastMsgByConv.get(c.id)
        const lastRead = lastReadById.get(c.id)
        const unread = !!last && last.sender_id !== user.id &&
          (!lastRead || new Date(last.created_at) > new Date(lastRead))
        return {
          id: c.id,
          is_group: c.is_group,
          title: c.title,
          last_message_at: c.last_message_at,
          created_at: c.created_at,
          other: otherByConv.get(c.id) ?? null,
          last_message: last ? preview(last) : null,
          unread,
        }
      })
      .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at))
  }

  return (
    <div className="flex flex-col h-screen bg-[#07061A]">
      <Header title="Messages" profile={profile as Profile} />
      <MessagesClient
        userId={user.id}
        contacts={contacts}
        initialConversations={conversations}
      />
    </div>
  )
}
