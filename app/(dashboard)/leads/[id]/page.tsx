import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/ui/Badge'
import { LeadDetailTabsClient } from '@/components/leads/LeadDetailTabsClient'
import { Profile, Lead } from '@/types'
import { formatDate } from '@/lib/utils'
import {
  Globe, Phone, Mail, MapPin, Star, Building2,
  MessageCircle, Share2, Calendar, Users, Flag,
  FileText, Tag, Lock, ExternalLink, Layers,
} from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'

interface PageProps {
  params: Promise<{ id: string }>
}

function InfoRow({ icon: Icon, label, value, href, iconCls = 'text-orange-400' }: {
  icon: React.ElementType
  label: string
  value: string | number | null | undefined
  href?: string
  iconCls?: string
}) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-center gap-2 text-xs min-w-0">
      <Icon size={11} className={`flex-shrink-0 ${iconCls}`} />
      <span className="text-slate-500 shrink-0">{label}</span>
      {href ? (
        <div className="flex items-center gap-1 min-w-0">
          <a href={href} target="_blank" rel="noreferrer"
            className="text-blue-400 hover:text-blue-300 hover:underline truncate flex items-center gap-1">
            {String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')}
            <ExternalLink size={9} className="flex-shrink-0" />
          </a>
          <CopyButton text={href} />
        </div>
      ) : (
        <span className="text-slate-200 truncate">{String(value)}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</p>
      {children}
    </div>
  )
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: lead } = await supabase
    .from('leads')
    .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role)')
    .eq('id', id)
    .single()

  if (!lead) notFound()

  const { data: agents } = await supabase.from('profiles').select('*').in('role', ['agent', 'sales_agent', 'admin'])
  const { data: developers } = await supabase.from('profiles').select('*').eq('role', 'developer')

  const stars = lead.gmb_review_rating
    ? '★'.repeat(Math.min(Math.floor(lead.gmb_review_rating), 5)) +
      '☆'.repeat(Math.max(0, 5 - Math.floor(lead.gmb_review_rating)))
    : null

  const PRIORITY_CLS: Record<string, string> = {
    'Urgent': 'text-red-400',
    'High':   'text-amber-400',
    'Normal': 'text-slate-400',
    'Low':    'text-slate-500',
  }

  return (
    <>
      <Header title={lead.company_name} profile={profile as Profile} />

      <div className="p-6 space-y-5">

        {/* ── Top identity bar ───────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h2 className="text-xl font-bold text-slate-100">{lead.company_name}</h2>
                {lead.lead_number && (
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-700/60 text-slate-400 border border-slate-600/40">
                    NVL-{String(lead.lead_number).padStart(3, '0')}
                  </span>
                )}
                <StatusBadge status={lead.status} />
                {lead.priority && lead.priority !== 'Normal' && (
                  <span className={`text-xs font-semibold ${PRIORITY_CLS[lead.priority] || 'text-slate-400'}`}>
                    ↑ {lead.priority}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm mb-3">{lead.name}</p>

              {/* Quick links row */}
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200">
                    <Phone size={12} className="text-orange-400" /> {lead.phone}
                  </a>
                )}
                {lead.whatsapp_number && (
                  <a href={`https://wa.me/${lead.whatsapp_number.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300">
                    <MessageCircle size={12} /> {lead.whatsapp_number}
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200">
                    <Mail size={12} className="text-orange-400" /> {lead.email}
                  </a>
                )}
                {lead.website_url && (
                  <span className="flex items-center gap-1">
                    <a href={lead.website_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                      <Globe size={12} /> {lead.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      <ExternalLink size={10} />
                    </a>
                    <CopyButton text={lead.website_url} />
                  </span>
                )}
                {lead.gmb_url && (
                  <span className="flex items-center gap-1">
                    <a href={lead.gmb_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-green-400 hover:text-green-300">
                      <MapPin size={12} /> Google Business
                      <ExternalLink size={10} />
                    </a>
                    <CopyButton text={lead.gmb_url} />
                  </span>
                )}
              </div>
            </div>

            <div className="text-right text-xs text-slate-500 flex flex-col gap-1">
              {lead.source && (
                <p>Source: <span className="text-slate-300">{lead.source}</span></p>
              )}
              {lead.assigned_agent && (
                <p>Agent: <span className="text-slate-300">{(lead.assigned_agent as any).full_name}</span></p>
              )}
              <p>Created: {formatDate(lead.created_at)}</p>
              <p>Updated: {formatDate(lead.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* ── Info grid ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">

          {/* Contact */}
          <Section title="Contact Information">
            <InfoRow icon={Users}   label="Contact Name"   value={lead.name} />
            <InfoRow icon={Phone}   label="Phone"          value={lead.phone}  href={lead.phone ? `tel:${lead.phone}` : undefined} />
            <InfoRow icon={MessageCircle} label="WhatsApp" value={lead.whatsapp_number} href={lead.whatsapp_number ? `https://wa.me/${lead.whatsapp_number.replace(/\D/g,'')}` : undefined} iconCls="text-emerald-400" />
            <InfoRow icon={Mail}    label="Email"          value={lead.email}  href={lead.email ? `mailto:${lead.email}` : undefined} />
          </Section>

          {/* Location */}
          <Section title="Location">
            <InfoRow icon={MapPin}  label="Address"        value={lead.address} />
            <InfoRow icon={MapPin}  label="City"           value={lead.city} />
            <InfoRow icon={MapPin}  label="ZIP / Pin Code" value={lead.zip_code} iconCls="text-slate-500" />
            <InfoRow icon={Flag}    label="Country"        value={lead.country} iconCls="text-slate-500" />
          </Section>

          {/* Online Presence */}
          <Section title="Online Presence">
            <InfoRow icon={Globe}   label="Website"        value={lead.website_url}  href={lead.website_url || undefined} />
            {lead.website_status && (
              <div className="flex items-center gap-2 text-xs min-w-0">
                <Globe size={11} className="text-slate-500 flex-shrink-0" />
                <span className="text-slate-500 shrink-0">Website Status</span>
                <span className={`font-medium truncate ${
                  lead.website_status?.includes('No website') ? 'text-red-400' :
                  lead.website_status?.includes('Outdated') ? 'text-amber-400' :
                  lead.website_status?.includes('Active') ? 'text-green-400' : 'text-slate-300'
                }`}>{lead.website_status}</span>
              </div>
            )}
            <InfoRow icon={Share2}  label="Social Profile"  value={lead.social_url}  href={lead.social_url || undefined} iconCls="text-blue-400" />
            <InfoRow icon={MapPin}  label="GMB Profile URL"  value={lead.gmb_url || null} href={lead.gmb_url || undefined} iconCls="text-green-400" />
          </Section>

          {/* GMB Stats */}
          {(lead.gmb_url || lead.gmb_review_rating || lead.number_of_reviews || lead.gmb_category || lead.gmb_last_seen || lead.competitor_count) && (
            <Section title="GMB & Competitive Data">
              <InfoRow icon={MapPin} label="GMB Profile URL" value={lead.gmb_url || null} href={lead.gmb_url || undefined} iconCls="text-green-400" />
              {lead.gmb_review_rating && (
                <div className="flex items-center gap-2 text-xs min-w-0">
                  <Star size={11} className="text-yellow-400 flex-shrink-0" />
                  <span className="text-slate-500 shrink-0">GMB Rating</span>
                  <span className="text-yellow-400 font-medium shrink-0">{stars} {lead.gmb_review_rating}</span>
                  {lead.number_of_reviews && (
                    <span className="text-slate-500 shrink-0">({lead.number_of_reviews} reviews)</span>
                  )}
                </div>
              )}
              <InfoRow icon={Building2} label="Category"           value={lead.gmb_category} iconCls="text-slate-400" />
              <InfoRow icon={Calendar}  label="Last Seen on GMB"    value={lead.gmb_last_seen ? formatDate(lead.gmb_last_seen) : null} iconCls="text-slate-400" />
              {lead.competitor_count != null && (
                <div className="flex items-center gap-2 text-xs min-w-0">
                  <Layers size={11} className={`flex-shrink-0 ${lead.competitor_count >= 7 ? 'text-red-400' : lead.competitor_count >= 4 ? 'text-amber-400' : 'text-green-400'}`} />
                  <span className="text-slate-500 shrink-0">Competitors Nearby</span>
                  <span className={`font-medium shrink-0 ${lead.competitor_count >= 7 ? 'text-red-400' : lead.competitor_count >= 4 ? 'text-amber-400' : 'text-green-400'}`}>
                    {lead.competitor_count}
                  </span>
                  {lead.competitor_notes && (
                    <span className="text-slate-400 truncate">— {lead.competitor_notes}</span>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Assignment */}
          <Section title="Assignment & Priority">
            <InfoRow icon={Users}   label="Assigned Agent"  value={(lead.assigned_agent as any)?.full_name} iconCls="text-blue-400" />
            <InfoRow icon={Flag}    label="Priority"        value={lead.priority} iconCls={PRIORITY_CLS[lead.priority || 'Normal']} />
            <InfoRow icon={Tag}     label="Pipeline Status" value={lead.status} iconCls="text-orange-400" />
            <InfoRow icon={Tag}     label="Lead Source"     value={lead.source} iconCls="text-slate-400" />
          </Section>

          {/* Notes */}
          {(lead.notes || lead.agent_private_notes || lead.custom_field_1_label || lead.custom_field_2_label) && (
            <Section title="Notes & Custom Fields">
              {lead.notes && (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <FileText size={11} className="text-slate-400" />
                    <span className="text-[10px] text-slate-500">Notes</span>
                  </div>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap pl-4">{lead.notes}</p>
                </div>
              )}
              {lead.custom_field_1_label && lead.custom_field_1_value && (
                <InfoRow icon={Tag} label={lead.custom_field_1_label} value={lead.custom_field_1_value} iconCls="text-purple-400" />
              )}
              {lead.custom_field_2_label && lead.custom_field_2_value && (
                <InfoRow icon={Tag} label={lead.custom_field_2_label} value={lead.custom_field_2_value} iconCls="text-purple-400" />
              )}
              {lead.agent_private_notes && (
                <div className="mt-1 pt-1.5 border-t border-slate-800 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Lock size={11} className="text-amber-400" />
                    <span className="text-[10px] text-amber-400 font-medium">Private Notes (Agent Only)</span>
                  </div>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap pl-4">{lead.agent_private_notes}</p>
                </div>
              )}
            </Section>
          )}
        </div>

        {/* ── Tabbed sub-records ──────────────────────────────── */}
        <LeadDetailTabsClient
          lead={lead as Lead}
          profile={profile as Profile}
          agents={(agents || []) as Profile[]}
          developers={(developers || []) as Profile[]}
          userId={user.id}
        />
      </div>
    </>
  )
}
