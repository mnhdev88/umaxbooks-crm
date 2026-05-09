'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LeadContactNote } from '@/types'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import { Plus, StickyNote, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

interface NotesTabProps {
  leadId: string
  userId: string
  userRole: string
}

export function NotesTab({ leadId, userId, userRole }: NotesTabProps) {
  const [notes, setNotes] = useState<LeadContactNote[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState({
    contact_date: new Date().toISOString().split('T')[0],
    note: '',
  })
  const supabase = createClient()

  useEffect(() => { fetchNotes() }, [leadId])

  async function fetchNotes() {
    const { data } = await supabase
      .from('lead_contact_notes')
      .select('*, author:profiles(full_name, role)')
      .eq('lead_id', leadId)
      .order('contact_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (data) setNotes(data as LeadContactNote[])
  }

  async function handleSave() {
    if (!form.note.trim()) return
    setLoading(true)
    await supabase.from('lead_contact_notes').insert({
      lead_id: leadId,
      user_id: userId,
      contact_date: form.contact_date,
      note: form.note.trim(),
    })
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Note Added',
      details: `Contact note added for ${formatDate(form.contact_date)}`,
    })
    setForm({ contact_date: new Date().toISOString().split('T')[0], note: '' })
    setShowForm(false)
    setLoading(false)
    fetchNotes()
  }

  async function handleDelete(id: string) {
    await supabase.from('lead_contact_notes').delete().eq('id', id)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  // Group notes by contact_date
  const grouped = notes.reduce<Record<string, LeadContactNote[]>>((acc, note) => {
    const key = note.contact_date
    if (!acc[key]) acc[key] = []
    acc[key].push(note)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} /> Add Note
        </Button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
          <Input
            label="Contact Date"
            type="date"
            min={new Date().toISOString().split('T')[0]}
            value={form.contact_date}
            onChange={(e) => setForm((f) => ({ ...f, contact_date: e.target.value }))}
          />
          <TextArea
            label="Note"
            rows={4}
            placeholder="What happened during this contact?"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} loading={loading}>Save Note</Button>
          </div>
        </div>
      )}

      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No contact notes yet.</div>
      ) : (
        <div className="space-y-3">
          {sortedDates.map((date) => {
            const dayNotes = grouped[date]
            const isOpen = expanded[date] !== false // default open
            return (
              <div key={date} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                {/* Date header */}
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [date]: !isOpen }))}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <StickyNote size={13} className="text-orange-400" />
                    <span className="text-sm font-semibold text-slate-200">{formatDate(date)}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
                      {dayNotes.length} {dayNotes.length === 1 ? 'note' : 'notes'}
                    </span>
                  </div>
                  {isOpen ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                </button>

                {isOpen && (
                  <div className="divide-y divide-slate-700/50">
                    {dayNotes.map((n) => (
                      <div key={n.id} className="px-4 py-3 space-y-1 group">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{n.note}</p>
                          {(n.user_id === userId || userRole === 'admin') && (
                            <button
                              onClick={() => handleDelete(n.id)}
                              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {n.author && (
                          <p className="text-[11px] text-slate-500 capitalize">
                            {n.author.full_name} · {n.author.role?.replace('_', ' ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
