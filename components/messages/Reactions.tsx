'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatReaction } from '@/types'
import { cn } from '@/lib/utils'
import { SmilePlus } from 'lucide-react'

// Emoji reactions on a message (083).
//
// In a team channel this is how a manager knows the message landed: 064's ✓✓
// ticks are defined from "the other participant's" timestamps and mean nothing
// with six members, so the channel hides them and shows reactions instead.
//
// Reactions deliberately fire no notification — reacting is the quiet
// acknowledgement. Pinging the sender's phone for a 👍 would defeat the point.

// Kept short on purpose: a long strip invites decoration, whereas the useful
// case is a fast ack. Any emoji already on a message still renders.
const QUICK = ['👍', '✅', '👀', '🎉', '❤️', '😂']

// All reactions for one conversation, keyed by message id. One subscription and
// one query per conversation rather than per message — a 50-message channel
// would otherwise open 50 realtime channels.
export function useReactions(conversationId: string | null) {
  const supabase = createClient()
  const [byMessage, setByMessage] = useState<Map<string, ChatReaction[]>>(new Map())

  const load = useCallback(async () => {
    if (!conversationId) { setByMessage(new Map()); return }
    // Inner-joined embed rather than .in() over pre-fetched message ids: the id
    // list grows with the thread and would eventually build an over-long URL.
    const { data } = await supabase
      .from('message_reactions')
      .select('message_id, user_id, emoji, messages!inner(conversation_id)')
      .eq('messages.conversation_id', conversationId)
    const next = new Map<string, ChatReaction[]>()
    for (const r of (data ?? []) as unknown as ChatReaction[]) {
      const list = next.get(r.message_id)
      if (list) list.push(r)
      else next.set(r.message_id, [r])
    }
    setByMessage(next)
  }, [supabase, conversationId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!conversationId) return
    // No filter available here: the realtime payload carries message_id, not
    // conversation_id. RLS already limits the stream to messages we can see, and
    // load() re-scopes to this conversation, so a refetch is correct if noisy.
    const channel = supabase
      .channel(`reactions-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, conversationId, load])

  return { byMessage, reload: load }
}

interface Props {
  messageId: string
  userId: string
  reactions: ChatReaction[]
  align?: 'start' | 'end'
}

export function Reactions({ messageId, userId, reactions, align = 'start' }: Props) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)

  // Group by emoji, tracking whether I'm in each group.
  const groups = new Map<string, { count: number; mine: boolean }>()
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false }
    g.count++
    if (r.user_id === userId) g.mine = true
    groups.set(r.emoji, g)
  }

  async function toggle(emoji: string) {
    setOpen(false)
    const mine = groups.get(emoji)?.mine
    // Optimism is unnecessary: the realtime subscription round-trips in ms and
    // an optimistic local edit would fight the refetch.
    if (mine) {
      await supabase.from('message_reactions').delete()
        .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji })
    }
  }

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', align === 'end' ? 'justify-end' : 'justify-start')}>
      {[...groups.entries()].map(([emoji, g]) => (
        <button
          key={emoji}
          onClick={() => toggle(emoji)}
          aria-label={g.mine ? `Remove ${emoji} reaction` : `React with ${emoji}`}
          aria-pressed={g.mine}
          className={cn(
            'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors',
            g.mine
              ? 'border-orange-500/60 bg-orange-500/20 text-orange-200'
              : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-600'
          )}
        >
          <span>{emoji}</span>
          <span className="tabular-nums">{g.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Add reaction"
          className={cn(
            'rounded-full p-1 text-slate-500 transition-opacity hover:text-slate-200',
            // Stays visible once reacted so the strip doesn't jump on hover.
            groups.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          )}
        >
          <SmilePlus size={13} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className={cn(
              'absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-xl border border-slate-700 bg-[#0E0B24] p-1 shadow-xl',
              align === 'end' ? 'right-0' : 'left-0'
            )}>
              {QUICK.map((e) => (
                <button
                  key={e}
                  onClick={() => toggle(e)}
                  aria-label={`React with ${e}`}
                  className="rounded-lg px-1.5 py-1 text-base leading-none hover:bg-slate-800"
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
