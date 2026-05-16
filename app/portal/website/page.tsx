import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExternalLink, Globe2, Server, Shield, Wrench, Mail } from 'lucide-react'
import { LiveSite, ClientEmail } from '@/types'
import { getPortalLeadId } from '@/lib/portal-context'

function ExpiryBadge({ date }: { date: string }) {
  const expiry   = new Date(date)
  const today    = new Date()
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const color =
    daysLeft <= 0  ? 'bg-red-500/20 text-red-400 border-red-500/30' :
    daysLeft <= 7  ? 'bg-red-500/20 text-red-400 border-red-500/30' :
    daysLeft <= 30 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                     'bg-green-500/20 text-green-400 border-green-500/30'

  const label =
    daysLeft <= 0  ? 'Expired' :
    daysLeft === 1 ? 'Expires tomorrow' :
    daysLeft <= 30 ? `Expires in ${daysLeft} days` :
    expiry.toLocaleDateString('en-US', { dateStyle: 'medium' })

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${color}`}>
      {label}
    </span>
  )
}

export default async function PortalWebsitePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  if (!leadId) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Globe2 size={40} className="text-slate-700 mx-auto mb-3" />
        <p>Website details will appear once your site is live.</p>
      </div>
    )
  }

  const [{ data: liveSite }, { data: clientEmails }] = await Promise.all([
    supabase.from('live_sites')
      .select('id, lead_id, final_url, go_live_date, hosting_provider, domain_status, domain_registrar, domain_expiry, hosting_expiry, ssl_expiry, maintenance_plan, maintenance_renewal_date, maintenance_monthly_amt')
      .eq('lead_id', leadId)
      .single(),
    supabase.from('client_emails')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at'),
  ])

  const site = liveSite as LiveSite | null
  const emails = (clientEmails ?? []) as ClientEmail[]

  if (!site) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-6">My Website</h1>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <Globe2 size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">Website details will appear here once your site is live.</p>
        </div>
      </div>
    )
  }

  const expiryRows = [
    { icon: Globe2,  label: 'Domain',           date: site.domain_expiry,            sub: site.domain_registrar },
    { icon: Server,  label: 'Hosting',           date: site.hosting_expiry,           sub: site.hosting_provider },
    { icon: Shield,  label: 'SSL Certificate',  date: site.ssl_expiry,               sub: null },
    { icon: Wrench,  label: 'Maintenance Plan', date: site.maintenance_renewal_date, sub: site.maintenance_monthly_amt ? `$${site.maintenance_monthly_amt}/mo` : null },
  ]

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">My Website</h1>
        <p className="text-slate-400 text-sm">Your live site details and renewal dates</p>
      </div>

      {/* Live site basics */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-700/60">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe2 size={16} className="text-orange-400 shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Live URL</p>
              <p className="text-white text-sm font-medium">{site.final_url ?? '—'}</p>
            </div>
          </div>
          {site.final_url && (
            <a
              href={site.final_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300 flex items-center gap-1 text-xs"
            >
              Open <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="p-4 flex items-center gap-3">
          <Server size={16} className="text-orange-400 shrink-0" />
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Hosting Provider</p>
            <p className="text-white text-sm">{site.hosting_provider ?? '—'}</p>
          </div>
        </div>
        {site.domain_registrar && (
          <div className="p-4 flex items-center gap-3">
            <Globe2 size={16} className="text-slate-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Domain Registrar</p>
              <p className="text-white text-sm">{site.domain_registrar}</p>
            </div>
          </div>
        )}
      </div>

      {/* Renewal dates */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Renewal Dates</h2>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-700/60">
          {expiryRows.map(({ icon: Icon, label, date, sub }) => (
            <div key={label} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon size={16} className="text-slate-500 shrink-0" />
                <div>
                  <p className="text-sm text-white">{label}</p>
                  {sub && <p className="text-xs text-slate-500">{sub}</p>}
                </div>
              </div>
              {date
                ? <ExpiryBadge date={date} />
                : <span className="text-xs text-slate-600">Not set</span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Client email accounts */}
      {emails.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Your Email Accounts</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-700/60">
            {emails.map(e => (
              <div key={e.id} className="p-4 flex items-center gap-3">
                <Mail size={16} className="text-orange-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{e.email_address}</p>
                  {(e.label || e.provider) && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[e.label, e.provider].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
