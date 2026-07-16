'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatContact, ChatConversation } from '@/types'
import { cn } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { toast } from 'sonner'
import { X, UserMinus, UserPlus, Crown, Loader2 } from 'lucide-react'

// Team channel members: who's in, who was removed, and the controls to change it.
//
// ── Why "removed" is a state you can see ───────────────────────────────────
// The roster is DERIVED from manager_id, so removing someone is not a delete —
// it is an exception recorded against the derived list (088). If that exception
// were invisible, a manager would remove David, see him vanish, and have no way
// to understand why he never came back, or to undo it. So removed agents stay
// listed, greyed out, with the way back.
//
// Only the channel's own manager and admins can see this section at all — the
// exclusions table's RLS returns nothing to anyone else, so the list is simply
// empty for them.

function Avatar({ name, size = 32, dim }: { name: string; size?: number; dim?: boolean }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold text-white',
        dim ? 'bg-slate-700' : 'bg-gradient-to-br from-orange-500 to-orange-700'
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  )
}

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface Props {
  conversation: ChatConversation
  userId: string
  myRole: string
  members: ChatContact[]
  onClose: () => void
  onChanged: () => void
}

export function MembersPanel({ conversation, userId, myRole, members, onClose, onChanged }: Props) {
  const supabase = createClient()
  const [removed, setRemoved] = useState<ChatContact[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const managerId = conversation.team_manager_id ?? null
  // Mirrors assert_can_manage_team_channel() in 088. The RPC is the real gate —
  // this only decides whether to render the controls.
  const canManage = myRole === 'admin' || (myRole === 'sales_manager' && managerId === userId)

  const loadRemoved = useCallback(async () => {
    if (!canManage) { setRemoved([]); return }
    const { data } = await supabase
      .from('team_channel_exclusions')
      .select('user_id, profile:profiles!team_channel_exclusions_user_id_fkey(id, full_name, role, avatar_url, last_seen_at)')
      .eq('conversation_id', conversation.id)
    setRemoved((data ?? []).map((r) => r.profile).filter(Boolean) as unknown as ChatContact[])
  }, [supabase, conversation.id, canManage])

  useEffect(() => { loadRemoved() }, [loadRemoved])

  async function remove(m: ChatContact) {
    if (!window.confirm(
      `Remove ${m.full_name} from ${conversation.title}?\n\n` +
      `They'll lose access to this channel's messages, but stay on the team — ` +
      `their leads, reports and targets are unaffected. You can add them back here.`
    )) return
    setBusy(m.id)
    const { error } = await supabase.rpc('remove_team_member', { p_conversation: conversation.id, p_user: m.id })
    setBusy(null)
    if (error) { toast.error(`Could not remove: ${describeSupabaseError(error)}`); return }
    toast.success(`${m.full_name} removed from the channel`)
    loadRemoved()
    onChanged()
  }

  async function addBack(m: ChatContact) {
    setBusy(m.id)
    const { error } = await supabase.rpc('add_team_member', { p_conversation: conversation.id, p_user: m.id })
    setBusy(null)
    if (error) { toast.error(`Could not add back: ${describeSupabaseError(error)}`); return }
    toast.success(`${m.full_name} added back`)
    loadRemoved()
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-[#0E0B24] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{conversation.title}</p>
            <p className="text-[11px] text-slate-500">
              {members.length} {members.length === 1 ? 'member' : 'members'} · synced from the team structure
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          <ul className="m-0 list-none divide-y divide-slate-800/70 p-0">
            {members.map((m) => {
              const isManager = m.id === managerId
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-200">
                      {m.full_name}
                      {m.id === userId && <span className="text-[10px] text-slate-500">(you)</span>}
                      {isManager && <Crown size={11} className="shrink-0 text-amber-400" aria-label="Team manager" />}
                    </p>
                    <p className="text-[10px] text-slate-500">{formatRole(m.role)}</p>
                  </div>
                  {/* The manager anchors the channel, so they can never be removed.
                      Admins aren't part of the derived roster — they use Leave. */}
                  {canManage && !isManager && m.role !== 'admin' && (
                    <button
                      onClick={() => remove(m)}
                      disabled={busy === m.id}
                      aria-label={`Remove ${m.full_name}`}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      {busy === m.id ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          {removed.length > 0 && (
            <>
              <div className="border-t border-slate-800 px-4 pb-1 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Removed from this channel
                </p>
                <p className="mt-0.5 text-[10px] text-slate-600">
                  Still on the team — their leads and reports are unaffected.
                </p>
              </div>
              <ul className="m-0 list-none divide-y divide-slate-800/70 p-0">
                {removed.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                    <Avatar name={m.full_name} dim />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-400">{m.full_name}</p>
                      <p className="text-[10px] text-slate-600">{formatRole(m.role)}</p>
                    </div>
                    <button
                      onClick={() => addBack(m)}
                      disabled={busy === m.id}
                      aria-label={`Add ${m.full_name} back`}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-orange-500/50 hover:text-orange-400 disabled:opacity-40"
                    >
                      {busy === m.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                      Add back
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {canManage && (
          <p className="border-t border-slate-800 px-4 py-2.5 text-[10px] leading-relaxed text-slate-600">
            Members are derived from each agent&apos;s assigned manager. New agents join automatically;
            removing someone here affects this channel only.
          </p>
        )}
      </div>
    </div>
  )
}
