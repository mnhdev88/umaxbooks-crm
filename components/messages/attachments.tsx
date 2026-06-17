'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { FileText, Download } from 'lucide-react'

export const CHAT_BUCKET = 'chat-attachments'
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB — matches the bucket cap

export interface UploadedAttachment {
  attachment_path: string
  attachment_name: string
  attachment_type: string
  attachment_size: number
}

// Upload a file into the conversation's folder. Throws on failure.
export async function uploadChatFile(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  file: File,
): Promise<UploadedAttachment> {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${conversationId}/${crypto.randomUUID()}-${safeName}`
  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw error
  return {
    attachment_path: path,
    attachment_name: file.name,
    attachment_type: file.type || 'application/octet-stream',
    attachment_size: file.size,
  }
}

// Force-download an attachment via a short-lived signed URL (works for images
// too, which would otherwise open inline).
export async function downloadAttachment(
  supabase: ReturnType<typeof createClient>,
  path: string,
  name?: string | null,
) {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, 60, { download: name ?? true })
  if (error || !data?.signedUrl) throw error ?? new Error('Could not create download link')
  const a = document.createElement('a')
  a.href = data.signedUrl
  a.download = name ?? ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Delete a message (and its attachment file if any). RLS restricts this to the
// sender / uploader. Throws on failure.
export async function deleteChatMessage(
  supabase: ReturnType<typeof createClient>,
  message: { id: string; attachment_path?: string | null },
) {
  if (message.attachment_path) {
    await supabase.storage.from(CHAT_BUCKET).remove([message.attachment_path])
  }
  const { error } = await supabase.from('messages').delete().eq('id', message.id)
  if (error) throw error
}

function humanSize(bytes?: number | null) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Renders a message attachment: inline image for images, a download chip
// otherwise. Resolves a short-lived signed URL (private bucket).
export function Attachment({
  path, name, type, size, mine,
}: {
  path: string
  name?: string | null
  type?: string | null
  size?: number | null
  mine: boolean
}) {
  const supabase = createClient()
  const [url, setUrl] = useState<string | null>(null)
  const isImage = !!type && type.startsWith('image/')

  useEffect(() => {
    let active = true
    supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 3600)
      .then(({ data }) => { if (active && data) setUrl(data.signedUrl) })
    return () => { active = false }
  }, [path, supabase])

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name ?? 'image'} className="rounded-lg max-h-60 w-auto object-cover" />
      </a>
    ) : (
      <div className="h-32 w-40 rounded-lg bg-slate-700/40 animate-pulse" />
    )
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      download={name ?? undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-2 max-w-[240px] transition-colors',
        mine ? 'bg-orange-600/40 hover:bg-orange-600/60' : 'bg-slate-700/60 hover:bg-slate-700'
      )}
    >
      <FileText size={20} className="shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{name ?? 'File'}</p>
        {!!size && <p className="text-[10px] opacity-70">{humanSize(size)}</p>}
      </div>
      <Download size={14} className="shrink-0 opacity-70" />
    </a>
  )
}
