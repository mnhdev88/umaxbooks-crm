import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, ChatContact, ChatConversation } from '@/types'
import { MessagesClient } from '@/components/messages/MessagesClient'
import { buildConversations, ConversationRow, MemberRow, RecentMessageRow } from '@/components/messages/conversation'

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

  // Materialise the team channel (082) BEFORE listing conversations, so it shows
  // up on first visit rather than after a refresh. Doing it here also means the
  // roster re-syncs from manager_id on every page load — a newly hired agent
  // appears without anyone maintaining a member list.
  //
  // Errors are swallowed on purpose: an agent with no manager assigned has no
  // team channel, which is a data state (see Roland), not a broken page. Admins
  // are excluded because they have no team of their own — they pick one.
  if (profile.role === 'sales_manager' || profile.role === 'sales_agent') {
    await supabase.rpc('get_or_create_team_group')
  }

  // Everyone you can DM: all staff except yourself.
  const { data: contactsRaw } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, last_seen_at')
    .neq('role', 'client')
    .neq('id', user.id)
    .order('full_name')
  const contacts = (contactsRaw ?? []) as ChatContact[]

  // Admins have no team of their own, so they choose whose channel to open.
  const managers = profile.role === 'admin'
    ? contacts.filter((c) => c.role === 'sales_manager')
    : []

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
        .select('id, is_group, title, team_manager_id, last_message_at, created_at')
        .in('id', convIds),
      supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)')
        .in('conversation_id', convIds),
      // Newest-first; enough to derive a preview + unread flag per thread.
      // parent_message_id comes along so buildConversations can ignore thread
      // replies when picking the preview line.
      supabase
        .from('messages')
        .select('conversation_id, body, created_at, sender_id, attachment_name, attachment_path, parent_message_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(400),
    ])

    conversations = buildConversations(
      user.id,
      (convs ?? []) as ConversationRow[],
      (members ?? []) as unknown as MemberRow[],
      (recent ?? []) as RecentMessageRow[],
      lastReadById,
    )
  }

  return (
    <div className="flex flex-col h-screen bg-[#07061A]">
      <Header title="Messages" profile={profile as Profile} />
      <MessagesClient
        userId={user.id}
        myName={profile.full_name ?? 'You'}
        myRole={profile.role}
        contacts={contacts}
        managers={managers}
        initialConversations={conversations}
      />
    </div>
  )
}
