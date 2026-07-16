'use client'

import { ChatContact, ChatMessage, ChatReaction } from '@/types'
import { cn } from '@/lib/utils'
import { Attachment } from './attachments'
import { MentionText } from './MentionTextarea'
import { Reactions } from './Reactions'
import { receiptFor, ReceiptTicks } from './receipts'
import { Download, Trash2, MessageSquare, Reply } from 'lucide-react'

// One message bubble. Shared by the channel view and the thread pane so a reply
// looks identical to a top-level message.
//
// ── Why receipts are conditional ────────────────────────────────────────────
// 064's ticks are computed from THE other participant's timestamps. In a group
// there is no such person, so `showReceipts` is false for channels and the
// acknowledgement signal is the reaction strip instead (083).

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-700 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  )
}

interface Props {
  message: ChatMessage
  userId: string
  members: ChatContact[]
  isGroup: boolean
  reactions: ChatReaction[]
  // Suppress the avatar/name when the previous bubble was from the same person.
  showSender: boolean
  showReceipts: boolean
  otherRead?: string | null
  otherDelivered?: string | null
  onOpenThread?: (m: ChatMessage) => void
  onDownload: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
}

export function MessageRow({
  message: m, userId, members, isGroup, reactions, showSender, showReceipts,
  otherRead, otherDelivered, onOpenThread, onDownload, onDelete,
}: Props) {
  const mine = m.sender_id === userId
  const sender = members.find((p) => p.id === m.sender_id)
  const senderName = sender?.full_name ?? 'Unknown'
  // Only label senders in a group: in a DM "the other person" is unambiguous.
  const labelSender = isGroup && !mine && showSender
  const replies = m.reply_count ?? 0

  return (
    <div className={cn('group flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {labelSender && (
        <div className="mb-0.5 flex items-center gap-1.5 px-1">
          <Avatar name={senderName} size={20} />
          <span className="text-[11px] font-medium text-slate-400">{senderName}</span>
        </div>
      )}

      {m.attachment_path && (
        <div className="max-w-[75%]">
          <Attachment
            path={m.attachment_path}
            name={m.attachment_name}
            type={m.attachment_type}
            size={m.attachment_size}
            mine={mine}
          />
        </div>
      )}

      {m.body && (
        <div className={cn(
          'max-w-[75%] break-words rounded-2xl px-3.5 py-2 text-sm',
          mine ? 'rounded-br-sm bg-orange-500 text-white' : 'rounded-bl-sm bg-slate-800 text-slate-100'
        )}>
          <p className="whitespace-pre-wrap">
            <MentionText body={m.body} members={members} mine={mine} />
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-slate-500">
          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>

        {mine && showReceipts && (
          <ReceiptTicks status={receiptFor(m.created_at, otherRead ?? null, otherDelivered ?? null)} />
        )}

        {onOpenThread && (
          <button
            onClick={() => onOpenThread(m)}
            aria-label={replies ? `View ${replies} replies` : 'Reply in thread'}
            className={cn(
              'flex items-center gap-1 text-[10px] transition-opacity',
              replies > 0
                ? 'text-orange-400 opacity-100 hover:text-orange-300'
                : 'text-slate-500 opacity-0 hover:text-slate-200 group-hover:opacity-100 focus:opacity-100'
            )}
          >
            {replies > 0 ? <MessageSquare size={12} /> : <Reply size={12} />}
            {replies > 0 && <span>{replies} {replies === 1 ? 'reply' : 'replies'}</span>}
          </button>
        )}

        {m.attachment_path && (
          <button
            onClick={() => onDownload(m)}
            aria-label="Download file"
            className="text-slate-500 opacity-0 transition-opacity hover:text-slate-200 group-hover:opacity-100 focus:opacity-100"
          >
            <Download size={13} />
          </button>
        )}
        {mine && m.attachment_path && (
          <button
            onClick={() => onDelete(m)}
            aria-label="Delete attachment"
            className="text-slate-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <Reactions
        messageId={m.id}
        userId={userId}
        reactions={reactions}
        align={mine ? 'end' : 'start'}
      />
    </div>
  )
}
