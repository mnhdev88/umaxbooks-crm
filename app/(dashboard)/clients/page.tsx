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
      .select('lead_id, final_url, created_at, leads(id, company_name, name, email, status)')
      .not('final_url', 'is', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name, lead_id, created_at')
      .eq('role', 'client'),
  ])

  // Ascending order assigns stable IDs (CLT-001 = first client ever); reverse for newest-first display
  const rowsAsc = (liveSites ?? []) as LiveSiteRow[]
  const rows = [...rowsAsc].reverse()
  const totalRows = rowsAsc.length
  const portalMap = new Map(
    ((clientProfiles ?? []) as ClientProfile[]).map(p => [p.lead_id, p])
  )

  return (
    <div className="flex flex-col min-h-screen bg-[#07061A]">
      <Header title="Clients" profile={profile as Profile} />

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
              <colgroup>
                <col className="w-32" />
                <col />
                <col />
                <col className="w-28" />
                <col className="w-44" />
                <col className="w-48" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/60">
                  <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Client ID</th>
                  <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Business</th>
                  <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Contact</th>
                  <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Status</th>
                  <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Portal</th>
                  <th scope="col" className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row, index) => {
                  const lead        = Array.isArray(row.leads) ? row.leads[0] ?? null : row.leads
                  const portalAcct  = lead ? portalMap.get(lead.id) : undefined
                  const leadId      = lead?.id ?? row.lead_id
                  const clientId    = `CLT-${String(totalRows - index).padStart(3, '0')}`

                  return (
                    <tr key={row.lead_id} className="hover:bg-slate-800/30 transition-colors">

                      {/* Client ID */}
                      <td className="px-5 py-4">
                        <span className="whitespace-nowrap text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-slate-700/60 text-orange-400 border border-slate-600/40">
                          {clientId}
                        </span>
                      </td>

                      {/* Business */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
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
                              className="text-xs text-slate-500 hover:text-blue-400 flex items-center gap-0.5 truncate transition-colors"
                            >
                              <Globe size={10} className="shrink-0" />
                              <span className="truncate">{row.final_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="px-5 py-4">
                        <p className="text-slate-200 truncate">{lead?.name ?? '—'}</p>
                        {lead?.email && (
                          <p className="text-slate-500 text-xs truncate mt-0.5">{lead.email}</p>
                        )}
                      </td>

                      {/* Lead status */}
                      <td className="px-5 py-4">
                        {lead?.status ? (
                          <span className={`inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium
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
                            <UserCheck size={13} className="shrink-0" />
                            <span className="truncate">
                              {portalAcct.full_name}
                              <span className="text-slate-600 ml-1">
                                · {new Date(portalAcct.created_at).toLocaleDateString('en-US', { dateStyle: 'short' })}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <UserX size={13} className="shrink-0" />
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
                                         transition-colors font-medium whitespace-nowrap"
                            >
                              <ExternalLink size={11} />
                              View Portal
                            </a>
                          )}
                          <Link
                            href={`/leads/${leadId}?tab=website-details`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                       bg-slate-700 hover:bg-slate-600 text-slate-200
                                       transition-colors whitespace-nowrap"
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
