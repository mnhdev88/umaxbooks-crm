import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { Globe, ExternalLink, Building2, UserCheck, UserX, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface LeadInfo {
  id: string
  company_name: string | null
  name: string | null
  email: string | null
  status: string | null
}

interface LiveSiteRow {
  lead_id: string
  final_url: string
  leads: LeadInfo | LeadInfo[] | null
}

interface ClientProfile {
  id: string
  full_name: string
  lead_id: string | null
  created_at: string
}

const STATUS_PILL: Record<string, string> = {
  Live:          'bg-green-500/15 text-green-400',
  Completed:     'bg-blue-500/15 text-blue-400',
  'In Progress': 'bg-yellow-500/15 text-yellow-400',
}

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile || profile.role !== 'admin') redirect('/')

  const [{ data: liveSites }, { data: clientProfiles }] = await Promise.all([
    supabase
      .from('live_sites')
      .select('lead_id, final_url, leads(id, company_name, name, email, status)')
      .not('final_url', 'is', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, lead_id, created_at')
      .eq('role', 'client'),
  ])

  const rows = (liveSites ?? []) as LiveSiteRow[]
  const portalMap = new Map(
    ((clientProfiles ?? []) as ClientProfile[]).map(p => [p.lead_id, p])
  )

  return (
    <div className="flex flex-col min-h-screen bg-[#060e1f]">
      <Header profile={profile as Profile} />

      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Clients</h1>
          <p className="text-slate-400 text-sm">All live client websites — manage portal details and invites</p>
        </div>

        {rows.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
            <Globe size={36} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400">No live sites yet.</p>
            <p className="text-slate-500 text-xs mt-1">
              Once a Final URL is saved on a lead&apos;s Live tab, it will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60">
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Business</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Contact</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Portal</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(row => {
                  const lead        = Array.isArray(row.leads) ? row.leads[0] ?? null : row.leads
                  const portalAcct  = lead ? portalMap.get(lead.id) : undefined
                  const leadId      = lead?.id ?? row.lead_id

                  return (
                    <tr key={row.lead_id} className="hover:bg-slate-800/30 transition-colors">

                      {/* Business */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700
                                          flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(lead?.company_name ?? lead?.name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white font-medium truncate">
                              {lead?.company_name ?? '—'}
                            </p>
                            <a
                              href={row.final_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5 truncate"
                            >
                              <Globe size={10} />
                              {row.final_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="px-5 py-4">
                        <p className="text-slate-200 truncate">{lead?.name ?? '—'}</p>
                        {lead?.email && (
                          <p className="text-slate-500 text-xs truncate">{lead.email}</p>
                        )}
                      </td>

                      {/* Lead status */}
                      <td className="px-5 py-4">
                        {lead?.status ? (
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium
                            ${STATUS_PILL[lead.status] ?? 'bg-slate-600/50 text-slate-300'}`}>
                            {lead.status}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Portal account status */}
                      <td className="px-5 py-4">
                        {portalAcct ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-400">
                            <UserCheck size={13} />
                            <span>
                              {portalAcct.full_name}
                              <span className="text-slate-600 ml-1">
                                · {new Date(portalAcct.created_at).toLocaleDateString('en-US', { dateStyle: 'short' })}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <UserX size={13} />
                            No account
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          {portalAcct && (
                            <a
                              href={`/api/portal-preview?lead_id=${leadId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                         bg-orange-500/15 hover:bg-orange-500/25 text-orange-400
                                         transition-colors font-medium"
                            >
                              <ExternalLink size={11} />
                              View Portal
                            </a>
                          )}
                          <Link
                            href={`/leads/${leadId}?tab=website-details`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                       bg-slate-700 hover:bg-slate-600 text-slate-200
                                       transition-colors"
                          >
                            Manage
                            <ArrowRight size={11} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
