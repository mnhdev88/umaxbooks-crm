'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatContact, ChatMessage, ChatReaction } from '@/types'
import { cn } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { MESSAGE_COLUMNS } from './conversation'
import { MessageRow } from './MessageRow'
import { MentionTextarea, MentionTextareaHandle, extractMentions } from './MentionTextarea'
import { EmojiPicker } from './EmojiPicker'
import { useTyping, typingLabel } from './typing'
import { downloadAttachment, deleteChatMessage } from './attachments'
import { toast } from 'sonner'
import { Send, X } from 'lucide-react'

// The thread pane: one top-level message plus its replies (085).
//
// Replies notify only the people already in the thread (plus anyone
// @mentioned) — the DB trigger enforces that, not this component. It matters
// because it is why a side discussion here doesn't buzz the whole channel's
// phones.

interface Props {
  parent: ChatMessage
  conversationId: string
  userId: string
  myName: string
  members: ChatContact[]
  isGroup: boolean
  reactionsByMessage: Map<string, ChatReaction[]>
  onClose: () => void
  // Keeps the channel's "N replies" pill honest without a refetch.
  onReplyCountChange: (parentId: string, delta: number) => void
}

export function ThreadPane({
  parent, conversationId, userId, myName, members, isGroup,
  reactionsByMessage, onClose, onReplyCountChange,
}: Props) {
  const supabase = createClient()
  const [replies, setReplies] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<MentionTextareaHandle>(null)
  const { typists, notifyTyping, clearTyping } = useTyping(`thread-${parent.id}`, userId, myName)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('parent_message_id', parent.id)
      .order('created_at', { ascending: true })
      .limit(500)
    setReplies((data as ChatMessage[]) ?? [])
    setLoading(false)
  }, [supabase, parent.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`thread-msgs-${parent.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as ChatMessage
        if (msg.parent_message_id !== parent.id) return
        setReplies((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        const old = payload.old as { id: string }
        setReplies((prev) => prev.filter((m) => m.id !== old.id))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, parent.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [replies])

  async function send() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setInput('')
    clearTyping()
    const { data, error } = await supabase
      .from('messages')
      .insert({
        // sender_id omitted on purpose — the DB stamps it from auth.uid() (migration 104).
        conversation_id: conversationId,
        body,
        parent_message_id: parent.id,
        mentions: extractMentions(body, members),
      })
      .select(MESSAGE_COLUMNS)
      .single()
    setSending(false)
    if (error || !data) {
      const detail = describeSupabaseError(error)
      console.error('Thread reply failed:', detail, error)
      toast.error(`Reply failed: ${detail}`)
      setInput(body)
      return
    }
    const msg = data as ChatMessage
    setReplies((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
    onReplyCountChange(parent.id, 1)
    inputRef.current?.focus()
  }

  async function remove(m: ChatMessage) {
    if (!window.confirm('Delete this message for everyone?')) return
    setReplies((prev) => prev.filter((x) => x.id !== m.id))
    onReplyCountChange(parent.id, -1)
    try {
      await deleteChatMessage(supabase, m)
    } catch (err) {
      toast.error(`Delete failed: ${describeSupabaseError(err)}`)
      onReplyCountChange(parent.id, 1)
      load()
    }
  }

  async function download(m: ChatMessage) {
    if (!m.attachment_path) return
    try {
      await downloadAttachment(supabase, m.attachment_path, m.attachment_name)
    } catch (err) {
      toast.error(`Download failed: ${describeSupabaseError(err)}`)
    }
  }

  const typing = typingLabel(typists)

  return (
    <aside className="flex w-full flex-col border-l border-slate-800 bg-[#0E0B24] md:w-96 md:shrink-0">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-slate-100">Thread</p>
          <p className="truncate text-[11px] leading-tight text-slate-500">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close thread" className="rounded p-1 text-slate-500 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {/* The message the thread hangs off, pinned above its replies. */}
        <div className="border-b border-slate-800 pb-3">
          <MessageRow
            message={{ ...parent, reply_count: 0 }}
            userId={userId}
            members={members}
            isGroup={isGroup}
            reactions={reactionsByMessage.get(parent.id) ?? []}
            showSender
            showReceipts={false}
            onDownload={download}
            onDelete={remove}
          />
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-slate-500">Loading…</p>
        ) : replies.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No replies yet. Start the thread.</p>
        ) : (
          replies.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              userId={userId}
              members={members}
              isGroup={isGroup}
              reactions={reactionsByMessage.get(m.id) ?? []}
              showSender={i === 0 || replies[i - 1].sender_id !== m.sender_id}
              showReceipts={false}
              onDownload={download}
              onDelete={remove}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {typing && (
        <p className="px-4 pb-1 text-[11px] italic text-slate-500" aria-live="polite">{typing}</p>
      )}

      <div className="shrink-0 border-t border-slate-800 p-3">
        <div className="flex items-end gap-2">
          <EmojiPicker
            onPick={(e) => inputRef.current?.insertAtCursor(e)}
            size={16}
            buttonClassName="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          />
          <MentionTextarea
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={send}
            onTyping={notifyTyping}
            members={members}
            placeholder="Reply…"
            className={cn(
              'max-h-32 w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm',
              'text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50'
            )}
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            aria-label="Send reply"
            className="shrink-0 rounded-xl bg-orange-500 p-2 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
