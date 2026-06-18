'use client'

import { useState, useRef, useEffect } from 'react'
import { Smile } from 'lucide-react'

// Curated, dependency-free set — covers the common faces, gestures, hearts and
// reactions used in team chat. Unicode only, so nothing to bundle.
const EMOJIS = [
  '😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘',
  '😋','😛','😜','🤪','🤨','🧐','🤓','😎','🥳','🤩','😏','😒','😔','😟','🙁','😣',
  '😩','🥺','😢','😭','😤','😠','😡','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓',
  '🤗','🤔','🤭','🤫','🤥','😶','😬','🙄','😴','🤤','😪','🥱','👋','🤝','👍','👎',
  '👌','✌️','🤞','🤟','🤘','👏','🙌','🙏','💪','👀','🔥','✨','🎉','🎊','💯','✅',
  '❌','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖','💕','😘','💋','⭐','⚡',
]

export function EmojiPicker({
  onPick,
  buttonClassName,
  size = 18,
}: {
  onPick: (emoji: string) => void
  buttonClassName?: string
  size?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Emoji"
        aria-expanded={open}
        className={buttonClassName}
      >
        <Smile size={size} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 z-50 w-64 max-h-48 overflow-y-auto bg-[#0E0B24] border border-slate-700 rounded-xl shadow-2xl p-2 grid grid-cols-8 gap-0.5"
        >
          {EMOJIS.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => onPick(e)}
              className="text-lg leading-none rounded p-1 hover:bg-slate-700/60 transition-colors"
              aria-label={`Insert ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
