'use client'

import { ExternalLink, Star, Globe, MapPin, FileText, User, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { US_TIMEZONES, formatDualTime } from '@/lib/timezone'

interface DevBriefTabProps {
  lead: any
}

const STATUS_CLS: Record<string, string> = {
  'New':            'bg-indigo-900/40 text-indigo-300',
  'Contacted':      'bg-amber-900/40 text-amber-300',
  'Audit Ready':    'bg-blue-900/40 text-blue-300',
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300',
  'Demo Done':      'bg-orange-900/40 text-orange-300',
  'Revision':       'bg-pink-900/40 text-pink-300',
  'Live':           'bg-teal-900/40 text-teal-300',
}

function Field({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (!value && value !== 0) return null
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={cn('text-sm text-slate-200', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  )
}

export function DevBriefTab({ lead }: DevBriefTabProps) {
  const audit = lead.audits?.[0]
  const appointment = lead.appointments?.[0]

  return (
    <div className="space-y-5">

      {/* Appointment notification banner */}
      {appointment?.appointment_datetime && (
        <div className="bg-purple-900/25 border border-purple-700/40 rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
            <Calendar size={13} className="text-purple-400" />
            Demo Scheduled
          </p>
          {appointment.timezone ? (
            (() => {
              const tzInfo = US_TIMEZONES.find(t => t.tz === appointment.timezone)
              const { us, ist, nextDayIST } = formatDualTime(
                appointment.appointment_datetime, appointment.timezone, tzInfo?.abbr ?? 'ET'
              )
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <Globe size={13} className="text-orange-400 flex-shrink-0" />
                    <span>{us}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <MapPin size={13} className="text-blue-400 flex-shrink-0" />
                    <span>{ist}</span>
                    {nextDayIST && (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">
                        +1 day
                      </span>
                    )}
                  </div>
                </div>
              )
            })()
          ) : (
            <p className="text-sm text-slate-300">
              {new Date(appointment.appointment_datetime).toLocaleString()}
            </p>
          )}
          {appointment.zoom_link && (
            <a href={appointment.zoom_link} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline">
              Join Zoom
            </a>
          )}
          {appointment.outcome_notes && (
            <p className="text-xs text-slate-500">{appointment.outcome_notes}</p>
          )}
        </div>
      )}

      {/* Lead brief card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">{lead.company_name}</h2>
            <p className="text-sm text-slate-500">{lead.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', STATUS_CLS[lead.status] || 'bg-slate-700 text-slate-300')}>
              {lead.status}
            </span>
            {lead.website_url && (
              <a href={lead.website_url} target="_blank" rel="noreferrer"
                className="text-blue-400 hover:text-blue-300">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Contact Person" value={lead.name} />
          <Field label="Phone" value={lead.phone} />
          <Field label="Email" value={lead.email} />
          <Field label="WhatsApp" value={lead.whatsapp_number} />
          <Field label="Website" value={lead.website_url} />
          <Field label="Website Status" value={lead.website_status} />
          <Field label="City" value={lead.city} />
          <Field label="Country" value={lead.country} />
          <Field label="Address" value={lead.address} />
          <Field label="ZIP Code" value={lead.zip_code} />
          <Field label="Social URL" value={lead.social_url} />
          <Field label="Source" value={lead.source} />
        </div>

        {/* GMB info */}
        {(lead.gmb_url || lead.gmb_review_rating) && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">GMB Info</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="GMB Category" value={lead.gmb_category} />
              {lead.gmb_review_rating && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Rating</p>
                  <p className="text-sm text-yellow-400 flex items-center gap-1">
                    <Star size={12} fill="currentColor" />
                    {lead.gmb_review_rating} ({lead.number_of_reviews || 0} reviews)
                  </p>
                </div>
              )}
              <Field label="Last Seen" value={lead.gmb_last_seen} />
              <Field label="Competitor Count" value={lead.competitor_count} />
            </div>
            {lead.competitor_notes && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 mb-1">Competitor Notes</p>
                <p className="text-xs text-slate-400 bg-slate-800 rounded-lg px-3 py-2">{lead.competitor_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agent notes (read-only) */}
      {lead.notes && (
        <div className="bg-orange-900/15 border border-orange-700/30 rounded-xl p-4">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <User size={12} /> Agent Notes
          </p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}

      {/* Audit reference files */}
      {audit && (audit.audit_short_pdf_url || audit.audit_long_pdf_url || audit.sitemap_pdf_url) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <FileText size={12} /> Reference Audit Files
          </p>
          <div className="flex flex-wrap gap-2">
            {audit.sitemap_pdf_url && (
              <a href={audit.sitemap_pdf_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-blue-400 transition-colors">
                <FileText size={11} /> Sitemap PDF
              </a>
            )}
            {audit.audit_short_pdf_url && (
              <a href={audit.audit_short_pdf_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-blue-400 transition-colors">
                <FileText size={11} /> Summary Audit
              </a>
            )}
            {audit.audit_long_pdf_url && (
              <a href={audit.audit_long_pdf_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-blue-400 transition-colors">
                <FileText size={11} /> Detailed Audit
              </a>
            )}
          </div>
          {audit.agent_notes && (
            <div className="mt-3 bg-slate-800 rounded-lg px-3 py-2">
              <p className="text-xs text-slate-500 mb-1">Audit Agent Notes</p>
              <p className="text-xs text-slate-400">{audit.agent_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
