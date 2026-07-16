'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ChatContact } from '@/types'
import { cn } from '@/lib/utils'

// The composer, with @mention autocomplete (084).
//
// ── Why mentions are re-derived from the text on send ───────────────────────
// The obvious design is to record an id the moment you pick a name from the
// dropdown. It is also wrong: the user can then backspace "@David Parker" out of
// the box and still silently ping David, because the id lingers in state. So the
// picker only inserts plain text, and extractMentions() reads the ids back off
// the final body at send time. What you see in the box is exactly who gets
// pinged — delete the text, un-send the ping.
//
// The cost is that two people with identical full names would both be
// mentioned. That is the right trade: over-notifying a namesake is recoverable,
// silently pinging someone whose name isn't there is not.

export function extractMentions(body: string, members: ChatContact[]): string[] {
  if (!body.includes('@')) return []
  const ids = new Set<string>()
  for (const m of members) {
    if (!m.full_name) continue
    if (body.includes('@' + m.full_name)) ids.add(m.id)
  }
  return [...ids]
}

// Renders the body with @names highlighted. Chat bodies are plain text and
// React escapes each chunk, so this cannot inject markup.
export function MentionText({ body, members, mine }: { body: string; members: ChatContact[]; mine?: boolean }) {
  const names = members.map((m) => m.full_name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length || !body.includes('@')) return <>{body}</>

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'))

  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') && names.some((n) => part === '@' + n) ? (
          <span
            key={i}
            className={cn(
              'rounded px-0.5 font-medium',
              mine ? 'bg-white/25 text-white' : 'bg-orange-500/25 text-orange-200'
            )}
          >
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  )
}

export interface MentionTextareaHandle {
  focus: () => void
  insertAtCursor: (text: string) => void
}

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onTyping?: () => void
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  members: ChatContact[]
  placeholder?: string
  className?: string
  rows?: number
}

export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(function MentionTextarea(
  { value, onChange, onSubmit, onTyping, onPaste, members, placeholder, className, rows = 1 },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insertAtCursor: (text: string) => {
      const el = taRef.current
      if (!el) { onChange(value + text); return }
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      onChange(value.slice(0, start) + text + value.slice(end))
      setTimeout(() => {
        el.focus()
        const pos = start + text.length
        el.setSelectionRange(pos, pos)
      }, 0)
    },
  }))

  const matches = query === null ? [] : members
    .filter((m) => m.full_name?.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6)

  // An "@" only opens the picker at a word boundary, so an email address typed
  // into chat doesn't turn into a mention prompt mid-word.
  function syncQuery(text: string, caret: number) {
    const upto = text.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1 || (at > 0 && !/\s/.test(upto[at - 1]))) { setQuery(null); return }
    const frag = upto.slice(at + 1)
    // A name may contain one space ("David Parker"), so allow at most one before
    // giving up — otherwise the picker would stay open for a whole sentence.
    if (frag.includes('\n') || (frag.match(/ /g)?.length ?? 0) > 1) { setQuery(null); return }
    setQuery(frag)
    setActive(0)
  }

  function pick(m: ChatContact) {
    const el = taRef.current
    const caret = el?.selectionStart ?? value.length
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return
    const next = value.slice(0, at) + '@' + m.full_name + ' ' + value.slice(caret)
    onChange(next)
    setQuery(null)
    setTimeout(() => {
      el?.focus()
      const pos = at + m.full_name.length + 2
      el?.setSelectionRange(pos, pos)
    }, 0)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return }
      // Enter/Tab commit the highlighted name instead of sending the message —
      // otherwise picking a mention would fire off a half-typed line.
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit() }
  }

  return (
    <div className="relative flex-1">
      {query !== null && matches.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setQuery(null)} />
          <ul
            role="listbox"
            className="absolute bottom-full z-20 mb-2 w-64 list-none overflow-hidden rounded-xl border border-slate-700 bg-[#0E0B24] p-1 shadow-2xl"
          >
            {matches.map((m, i) => (
              <li key={m.id}>
                <button
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    i === active ? 'bg-orange-500/20 text-white' : 'text-slate-300 hover:bg-slate-800'
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-[10px] font-bold text-white">
                    {m.full_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{m.full_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <textarea
        ref={taRef}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          syncQuery(e.target.value, e.target.selectionStart ?? 0)
          onTyping?.()
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={className}
      />
    </div>
  )
})
