import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Globe2, Calendar, AlertTriangle } from 'lucide-react'
import { LiveSite, Lead } from '@/types'
import { getPortalLeadId } from '@/lib/portal-context'

async function getExpiryWarnings(leadId: string, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('live_sites')
    .select('domain_expiry, hosting_expiry, ssl_expiry, maintenance_renewal_date')
    .eq('lead_id', leadId)
    .single()
  if (!data) return []

  const today = new Date()
  const checks = [
    { label: 'Domain',      date: data.domain_expiry },
    { label: 'Hosting',     date: data.hosting_expiry },
    { label: 'SSL Cert',    date: data.ssl_expiry },
    { label: 'Maintenance', date: data.maintenance_renewal_date },
  ]
  return checks
    .filter(c => c.date)
    .map(c => {
      const days = Math.ceil((new Date(c.date!).getTime() - today.getTime()) / 86400000)
      return { ...c, days }
    })
    .filter(c => c.days <= 30)
    .sort((a, b) => a.days - b.days)
}

export default async function PortalOverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  if (!leadId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Globe2 size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">Your project is being set up. Check back soon.</p>
        </div>
      </div>
    )
  }

  const [{ data: lead }, { data: liveSite }, warnings] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).single(),
    supabase.from('live_sites')
      .select('final_url, go_live_date, hosting_provider, domain_status')
      .eq('lead_id', leadId).single(),
    getExpiryWarnings(leadId, supabase),
  ])

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).single()

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-1">
        Welcome back, {profile?.full_name}
      </h1>
      <p className="text-slate-400 text-sm mb-8">Here&apos;s the current status of your project</p>

      {warnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {warnings.map(w => (
            <div
              key={w.label}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
                w.days <= 7
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
              }`}
            >
              <AlertTriangle size={15} className="shrink-0" />
              <span>
                <span className="font-medium">{w.label}</span>
                {w.days <= 0
                  ? ' has expired — please contact us urgently.'
                  : w.days === 1
                  ? ' expires tomorrow — we\'ll handle the renewal.'
                  : ` expires in ${w.days} days — we'll handle the renewal.`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Project Status</p>
          <p className="text-lg font-semibold text-orange-400">{(lead as Lead)?.status ?? '—'}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Go Live Date</p>
          <p className="text-lg font-semibold text-white flex items-center gap-2">
            <Calendar size={15} className="text-orange-400" />
            {(liveSite as LiveSite)?.go_live_date
              ? new Date((liveSite as LiveSite).go_live_date!).toLocaleDateString('en-US', { dateStyle: 'medium' })
              : '—'}
          </p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <p className="text-xs text-slate-500 mb-1">Live URL</p>
          {(liveSite as LiveSite)?.final_url ? (
            <a
              href={(liveSite as LiveSite).final_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:underline text-sm break-all flex items-center gap-1"
            >
              <Globe2 size={13} />
              {(liveSite as LiveSite).final_url!.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          ) : (
            <p className="text-slate-500 text-sm">Not live yet</p>
          )}
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Your Project Details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-slate-500 mb-0.5">Business Name</dt>
            <dd className="text-white font-medium">{(lead as Lead)?.company_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">Contact Name</dt>
            <dd className="text-white">{(lead as Lead)?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">Phone</dt>
            <dd className="text-white">{(lead as Lead)?.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500 mb-0.5">Email</dt>
            <dd className="text-white">{(lead as Lead)?.email ?? '—'}</dd>
          </div>
          {(lead as Lead)?.city && (
            <div>
              <dt className="text-slate-500 mb-0.5">City</dt>
              <dd className="text-white">{(lead as Lead).city}</dd>
            </div>
          )}
          {(liveSite as LiveSite)?.hosting_provider && (
            <div>
              <dt className="text-slate-500 mb-0.5">Hosting</dt>
              <dd className="text-white">{(liveSite as LiveSite).hosting_provider}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
