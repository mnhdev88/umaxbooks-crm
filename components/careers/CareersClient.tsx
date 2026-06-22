'use client'

import { Fragment, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Briefcase, Plus, Pencil, Trash2, Loader2, X, ChevronDown, ChevronUp,
  Inbox, ExternalLink, MapPin, Eye, EyeOff,
} from 'lucide-react'

export interface JobPosting {
  id: string
  title: string
  region: 'us' | 'india' | 'freelance'
  openings: number
  job_location: string | null
  shift: string | null
  description: string | null
  pills: string[] | null
  apply_note_title: string | null
  apply_note_points: string[] | null
  apply_note_footer: string | null
  footer_note: string | null
  btn_label: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface JobApplication {
  id: string
  job_id: string | null
  job_title: string | null
  name: string
  email: string
  phone: string | null
  linkedin: string | null
  cover: string | null
  responsibilities: string | null
  seo_tasks: string | null
  live_urls: string | null
  results: string | null
  tools: string | null
  resume_url: string | null
  status: string
  created_at: string
}

interface Props {
  initialJobs: JobPosting[]
  initialApplications: JobApplication[]
}

const APP_STATUSES = ['new', 'reviewed', 'interview', 'hired', 'rejected'] as const

const REGION_LABELS: Record<JobPosting['region'], string> = {
  us:        '🇺🇸 United States',
  india:     '🇮🇳 India',
  freelance: '🌐 Remote / Freelance',
}

const REGION_STYLES: Record<JobPosting['region'], string> = {
  us:        'bg-blue-500/15 text-blue-300 border-blue-500/30',
  india:     'bg-green-500/15 text-green-300 border-green-500/30',
  freelance: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
}

const STATUS_STYLES: Record<string, string> = {
  new:       'bg-orange-500/15 text-orange-300 border-orange-500/30',
  reviewed:  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  interview: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  hired:     'bg-green-500/15 text-green-300 border-green-500/30',
  rejected:  'bg-red-500/15 text-red-300 border-red-500/30',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const EMPTY_FORM = {
  title: '',
  region: 'us' as 'us' | 'india' | 'freelance',
  openings: 1,
  job_location: '',
  shift: '',
  description: '',
  pills: '',
  apply_note_title: '',
  apply_note_points: '',
  apply_note_footer: '',
  footer_note: '',
  btn_label: '',
  sort_order: 0,
  is_active: true,
}

type JobForm = typeof EMPTY_FORM

function jobToForm(job: JobPosting): JobForm {
  return {
    title: job.title,
    region: job.region,
    openings: job.openings,
    job_location: job.job_location ?? '',
    shift: job.shift ?? '',
    description: job.description ?? '',
    pills: (job.pills ?? []).join('\n'),
    apply_note_title: job.apply_note_title ?? '',
    apply_note_points: (job.apply_note_points ?? []).join('\n'),
    apply_note_footer: job.apply_note_footer ?? '',
    footer_note: job.footer_note ?? '',
    btn_label: job.btn_label ?? '',
    sort_order: job.sort_order,
    is_active: job.is_active,
  }
}

function formToRecord(form: JobForm) {
  const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)
  return {
    title: form.title.trim(),
    region: form.region,
    openings: Number(form.openings) || 1,
    job_location: form.job_location.trim() || null,
    shift: form.shift.trim() || null,
    description: form.description.trim() || null,
    pills: lines(form.pills),
    apply_note_title: form.apply_note_title.trim() || null,
    apply_note_points: lines(form.apply_note_points).length ? lines(form.apply_note_points) : null,
    apply_note_footer: form.apply_note_footer.trim() || null,
    footer_note: form.footer_note.trim() || null,
    btn_label: form.btn_label.trim() || null,
    sort_order: Number(form.sort_order) || 0,
    is_active: form.is_active,
  }
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/60'
const labelCls = 'block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5'

export function CareersClient({ initialJobs, initialApplications }: Props) {
  const supabase = createClient()
  const [tab, setTab] = useState<'openings' | 'applications'>('openings')
  const [jobs, setJobs] = useState<JobPosting[]>(initialJobs)
  const [applications, setApplications] = useState<JobApplication[]>(initialApplications)

  // Job modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<JobForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Applications state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  const newCount = applications.filter(a => a.status === 'new').length

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, sort_order: jobs.length + 1 })
    setModalOpen(true)
  }

  function openEdit(job: JobPosting) {
    setEditingId(job.id)
    setForm(jobToForm(job))
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required.'); return }
    setSaving(true)
    const record = formToRecord(form)
    try {
      if (editingId) {
        const { data, error } = await supabase
          .from('job_postings')
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq('id', editingId)
          .select()
          .single()
        if (error) throw error
        setJobs(prev => prev.map(j => (j.id === editingId ? data : j)).sort((a, b) => a.sort_order - b.sort_order))
        toast.success('Job updated.')
      } else {
        const { data, error } = await supabase
          .from('job_postings')
          .insert(record)
          .select()
          .single()
        if (error) throw error
        setJobs(prev => [...prev, data].sort((a, b) => a.sort_order - b.sort_order))
        toast.success('Job created.')
      }
      setModalOpen(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save job.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(job: JobPosting) {
    setTogglingId(job.id)
    const { error } = await supabase
      .from('job_postings')
      .update({ is_active: !job.is_active, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    setTogglingId(null)
    if (error) { toast.error(error.message); return }
    setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, is_active: !j.is_active } : j)))
    toast.success(job.is_active ? 'Job hidden from the website.' : 'Job is now live on the website.')
  }

  async function handleDelete(job: JobPosting) {
    if (!confirm(`Delete "${job.title}"? Applications keep their copy of the job title.`)) return
    setDeletingId(job.id)
    const { error } = await supabase.from('job_postings').delete().eq('id', job.id)
    setDeletingId(null)
    if (error) { toast.error(error.message); return }
    setJobs(prev => prev.filter(j => j.id !== job.id))
    toast.success('Job deleted.')
  }

  async function handleStatusChange(app: JobApplication, status: string) {
    setUpdatingStatusId(app.id)
    const { error } = await supabase.from('job_applications').update({ status }).eq('id', app.id)
    setUpdatingStatusId(null)
    if (error) { toast.error(error.message); return }
    setApplications(prev => prev.map(a => (a.id === app.id ? { ...a, status } : a)))
  }

  const set = (key: keyof JobForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          <button
            onClick={() => setTab('openings')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              tab === 'openings' ? 'bg-orange-500/15 text-orange-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Briefcase size={14} /> Openings
            <span className="text-[11px] text-slate-500">{jobs.length}</span>
          </button>
          <button
            onClick={() => setTab('applications')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              tab === 'applications' ? 'bg-orange-500/15 text-orange-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Inbox size={14} /> Applications
            <span className="text-[11px] text-slate-500">{applications.length}</span>
            {newCount > 0 && (
              <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{newCount} new</span>
            )}
          </button>
        </div>

        {tab === 'openings' && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            <Plus size={14} /> Add Job
          </button>
        )}
      </div>

      {/* ── Openings tab ── */}
      {tab === 'openings' && (
        jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <Briefcase size={40} className="text-slate-700" />
            <p className="text-slate-400 font-medium">No job postings yet</p>
            <p className="text-slate-600 text-sm">Jobs you add here appear on noveliotech.com/careers.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {jobs.map(job => (
              <div key={job.id} className={`bg-slate-900 border rounded-xl p-5 ${job.is_active ? 'border-slate-800' : 'border-slate-800 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-slate-100 font-semibold text-[15px]">{job.title}</h3>
                      {job.openings > 1 && <span className="text-xs text-slate-500">({job.openings} openings)</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${REGION_STYLES[job.region]}`}>
                        {REGION_LABELS[job.region]}
                      </span>
                      {job.shift && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/40">{job.shift}</span>
                      )}
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        job.is_active
                          ? 'bg-green-500/15 text-green-300 border-green-500/30'
                          : 'bg-slate-700/60 text-slate-400 border-slate-600/40'
                      }`}>
                        {job.is_active ? 'Live' : 'Hidden'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-600 shrink-0">#{job.sort_order}</span>
                </div>

                {job.job_location && (
                  <div className="flex items-start gap-1.5 text-xs text-slate-500 mb-2">
                    <MapPin size={12} className="mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{job.job_location}</span>
                  </div>
                )}

                {job.description && (
                  <p className="text-[13px] text-slate-400 leading-relaxed mb-3 line-clamp-3">{job.description}</p>
                )}

                {(job.pills?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {job.pills!.map((p, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">{p}</span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
                  <button
                    onClick={() => handleToggleActive(job)}
                    disabled={togglingId === job.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-600/40 disabled:opacity-50"
                  >
                    {togglingId === job.id ? <Loader2 size={11} className="animate-spin" /> : job.is_active ? <EyeOff size={11} /> : <Eye size={11} />}
                    {job.is_active ? 'Hide' : 'Publish'}
                  </button>
                  <button
                    onClick={() => openEdit(job)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-600/40"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(job)}
                    disabled={deletingId === job.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-950/60 text-red-400 hover:bg-red-900/60 hover:text-red-300 transition-colors border border-red-800/40 disabled:opacity-50 ml-auto"
                  >
                    {deletingId === job.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Applications tab ── */}
      {tab === 'applications' && (
        applications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <Inbox size={40} className="text-slate-700" />
            <p className="text-slate-400 font-medium">No applications yet</p>
            <p className="text-slate-600 text-sm">Submissions from the website's Apply form will appear here.</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Applicant</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Role</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Contact</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Applied</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app, i) => (
                    <Fragment key={app.id}>
                      <tr
                        className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-slate-800/10'}`}
                        onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                      >
                        <td className="px-4 py-3 text-slate-200 font-medium">{app.name}</td>
                        <td className="px-4 py-3 text-slate-400">{app.job_title || '—'}</td>
                        <td className="px-4 py-3 text-slate-400">
                          <div>{app.email}</div>
                          {app.phone && <div className="text-xs text-slate-500">{app.phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(app.created_at)}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <select
                            value={app.status}
                            disabled={updatingStatusId === app.id}
                            onChange={e => handleStatusChange(app, e.target.value)}
                            className={`text-xs font-semibold px-2 py-1 rounded-lg border bg-slate-900 cursor-pointer focus:outline-none disabled:opacity-50 ${STATUS_STYLES[app.status] || STATUS_STYLES.new}`}
                          >
                            {APP_STATUSES.map(s => (
                              <option key={s} value={s} className="bg-slate-900 text-slate-200">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {expandedId === app.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                      </tr>
                      {expandedId === app.id && (
                        <tr className="border-b border-slate-800/50 bg-slate-800/20">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
                              {([
                                ['LinkedIn / Portfolio', app.linkedin],
                                ['Why this role', app.cover],
                                ['Responsibilities', app.responsibilities],
                                ['SEO tasks executed', app.seo_tasks],
                                ['Live URLs', app.live_urls],
                                ['Results achieved', app.results],
                                ['Tools used', app.tools],
                              ] as const).filter(([, v]) => v).map(([label, value]) => (
                                <div key={label}>
                                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
                                  <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{value}</p>
                                </div>
                              ))}
                              {app.resume_url && (
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Resume</p>
                                  <a
                                    href={app.resume_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 text-orange-400 hover:text-orange-300 font-medium"
                                  >
                                    <ExternalLink size={12} /> Open resume
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Job create/edit modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)} />
          <div className="relative bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
              <h2 className="text-slate-100 font-semibold text-[15px]">{editingId ? 'Edit Job' : 'Add Job'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-500 hover:text-white p-1.5 rounded transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Job Title *</label>
                  <input className={inputCls} value={form.title} onChange={set('title')} placeholder="e.g. Sales Executive" />
                </div>
                <div>
                  <label className={labelCls}>Region</label>
                  <select className={inputCls} value={form.region} onChange={set('region')}>
                    <option value="us">🇺🇸 United States</option>
                    <option value="india">🇮🇳 India</option>
                    <option value="freelance">🌐 Remote / Freelance</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Shift / Work Mode</label>
                  <input className={inputCls} value={form.shift} onChange={set('shift')} placeholder="Hybrid / Night Shift / Day Shift" />
                </div>
                <div>
                  <label className={labelCls}>Openings</label>
                  <input className={inputCls} type="number" min={1} value={form.openings} onChange={set('openings')} />
                </div>
                <div>
                  <label className={labelCls}>Sort Order</label>
                  <input className={inputCls} type="number" value={form.sort_order} onChange={set('sort_order')} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Location (display text)</label>
                  <input className={inputCls} value={form.job_location} onChange={set('job_location')} placeholder="Gurgaon, Delhi NCR | Work from Office" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Description</label>
                  <textarea className={`${inputCls} resize-none`} rows={4} value={form.description} onChange={set('description')} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Skill Pills (one per line)</label>
                  <textarea className={`${inputCls} resize-none`} rows={3} value={form.pills} onChange={set('pills')} placeholder={'B2B Sales\n2–4 Years Experience\nFull-Time'} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>"How to Apply" Note Title (optional)</label>
                  <input className={inputCls} value={form.apply_note_title} onChange={set('apply_note_title')} placeholder="⚠ How to Apply — Please Read Before Sending" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>"How to Apply" Points (one per line)</label>
                  <textarea className={`${inputCls} resize-none`} rows={3} value={form.apply_note_points} onChange={set('apply_note_points')} />
                </div>
                <div>
                  <label className={labelCls}>Note Footer</label>
                  <input className={inputCls} value={form.apply_note_footer} onChange={set('apply_note_footer')} placeholder="CV is optional." />
                </div>
                <div>
                  <label className={labelCls}>Card Footer Note</label>
                  <input className={inputCls} value={form.footer_note} onChange={set('footer_note')} placeholder="Send your work profile to: ajay@noveliotech.com" />
                </div>
                <div>
                  <label className={labelCls}>Button Label</label>
                  <input className={inputCls} value={form.btn_label} onChange={set('btn_label')} placeholder="Apply Now →" />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="accent-orange-500 w-4 h-4"
                    />
                    Live on website
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 shrink-0">
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-60"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {editingId ? 'Save Changes' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
