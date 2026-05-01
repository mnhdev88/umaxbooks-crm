'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Trash2, Edit2, Save, ChevronDown, ChevronUp } from 'lucide-react'

interface EmailTemplate {
  id: string
  name: string
  subject: string
  html_body: string
  created_at: string
}

const EMPTY = { name: '', subject: '', html_body: '' }

export function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY)
  const [editId, setEditId]       = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('email_templates').select('*').order('created_at')
    setTemplates(data || [])
  }

  function startEdit(t: EmailTemplate) {
    setEditId(t.id)
    setForm({ name: t.name, subject: t.subject, html_body: t.html_body })
    setShowForm(true)
    setExpanded(null)
  }

  function cancel() {
    setShowForm(false)
    setEditId(null)
    setForm(EMPTY)
  }

  async function save() {
    if (!form.name || !form.html_body) return
    setSaving(true)
    if (editId) {
      await supabase.from('email_templates').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editId)
    } else {
      await supabase.from('email_templates').insert(form)
    }
    setSaving(false)
    cancel()
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this template?')) return
    await supabase.from('email_templates').delete().eq('id', id)
    load()
  }

  return (
    <div className="bg-[#0d1f3c] border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white font-semibold text-lg">Email Templates</h2>
          <p className="text-slate-400 text-sm mt-1">Create HTML email templates for agents to use when sending reports</p>
        </div>
        <button
          onClick={() => { showForm ? cancel() : setShowForm(true) }}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'New Template'}
        </button>
      </div>

      {showForm && (
        <div className="bg-[#0a1628] border border-white/10 rounded-xl p-5 mb-6 space-y-4">
          <h3 className="text-white font-medium text-sm">{editId ? 'Edit Template' : 'New Template'}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Template Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Initial SEO Audit Report"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Default Subject</label>
              <input
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="Your SEO Audit Report — {{business_name}}"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-400">HTML Body</label>
              <span className="text-xs text-slate-500">Use {'{{client_name}}'}, {'{{business_name}}'}, {'{{report_url}}'} as placeholders</span>
            </div>
            <textarea
              value={form.html_body}
              onChange={e => setForm(f => ({ ...f, html_body: e.target.value }))}
              placeholder="Paste your HTML email template here…"
              rows={14}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={cancel} className="text-slate-400 hover:text-white px-4 py-2 text-sm transition-colors">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !form.name || !form.html_body}
              className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : editId ? 'Update Template' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 && !showForm ? (
        <p className="text-center text-slate-400 text-sm py-10">No templates yet. Create one for agents to use.</p>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">{t.name}</p>
                  {t.subject && <p className="text-slate-400 text-xs truncate mt-0.5">Subject: {t.subject}</p>}
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                    className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                    title="Preview HTML"
                  >
                    {expanded === t.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => startEdit(t)}
                    className="text-slate-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-blue-400/10 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    className="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {expanded === t.id && (
                <div className="border-t border-white/10 p-4">
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap overflow-auto max-h-64 bg-black/20 rounded-lg p-3">
                    {t.html_body}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
