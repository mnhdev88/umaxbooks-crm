'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// "X is typing…" over Realtime broadcast.
//
// Broadcast, NOT a table column: a typing flag is worthless a second later, and
// writing one per keystroke would put a stream of pointless UPDATEs (and their
// RLS checks and WAL) through Postgres for something no one ever reads back.
// Broadcast never touches the DB.
//
// The channel name is per-conversation, so members only hear their own thread.
// No RLS applies to broadcast — but the only thing on the wire is a display name
// and the fact that someone is typing, and the sender is already a member of a
// thread whose id you would need to guess to listen in.

const TYPING_TTL_MS = 4000   // drop a typist this long after their last keystroke
const THROTTLE_MS   = 1500   // at most one broadcast per this window per typist

export interface Typist { userId: string; name: string }

export function useTyping(conversationId: string | null, userId: string, myName: string) {
  const supabase = createClient()
  const [typists, setTypists] = useState<Typist[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lastSentRef = useRef(0)
  // Per-typist expiry timers, so one person going quiet doesn't clear another.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (!conversationId) { setTypists([]); return }
    const timers = timersRef.current

    const channel = supabase
      .channel(`typing-${conversationId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as Typist
        if (!p?.userId || p.userId === userId) return

        setTypists((prev) => prev.some((t) => t.userId === p.userId) ? prev : [...prev, p])

        clearTimeout(timers.get(p.userId))
        timers.set(p.userId, setTimeout(() => {
          setTypists((prev) => prev.filter((t) => t.userId !== p.userId))
          timers.delete(p.userId)
        }, TYPING_TTL_MS))
      })
      .subscribe()

    channelRef.current = channel
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
      setTypists([])
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [supabase, conversationId, userId])

  // Call on every keystroke; throttled internally.
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSentRef.current < THROTTLE_MS) return
    lastSentRef.current = now
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, name: myName } satisfies Typist,
    })
  }, [userId, myName])

  // Sending a message means you've stopped typing — clear the throttle so the
  // next keystroke broadcasts immediately rather than sitting out the window.
  const clearTyping = useCallback(() => { lastSentRef.current = 0 }, [])

  return { typists, notifyTyping, clearTyping }
}

export function typingLabel(typists: Typist[]): string | null {
  if (typists.length === 0) return null
  if (typists.length === 1) return `${typists[0].name} is typing…`
  if (typists.length === 2) return `${typists[0].name} and ${typists[1].name} are typing…`
  return 'Several people are typing…'
}
