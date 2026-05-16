import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LifeBuoy } from 'lucide-react'
import { SupportRequestForm } from '@/components/portal/SupportRequestForm'
import { SupportRequest } from '@/types'
import { getPortalLeadId } from '@/lib/portal-context'

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-slate-600/50 text-slate-300',
  in_progress: 'bg-blue-500/20 text-blue-400',
  resolved:    'bg-green-500/20 text-green-400',
}

const TYPE_LABEL: Record<string, string> = {
  revision: 'Revision',
  bug:      'Bug Report',
  content:  'Content Update',
  other:    'Other',
}

export default async function PortalSupportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { leadId } = await getPortalLeadId()

  const { data: requests } = await supabase
    .from('support_requests')
    .select('*')
    .eq('client_id', user.id)
    .order('created_at', { ascending: false })

  const reqList = (requests ?? []) as SupportRequest[]

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Support</h1>
        <p className="text-slate-400 text-sm">
          Submit a change request, bug report, or content update
        </p>
      </div>

      {leadId ? (
        <SupportRequestForm leadId={leadId} clientId={user.id} />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center text-slate-400">
          <LifeBuoy size={32} className="text-slate-700 mx-auto mb-2" />
          Support will be available once your project is live.
        </div>
      )}

      {/* Past requests */}
      {reqList.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Your Requests</h2>
          <div className="space-y-3">
            {reqList.map(r => (
              <div key={r.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium">{r.title}</p>
                    {r.description && (
                      <p className="text-slate-400 text-xs mt-1 leading-relaxed">{r.description}</p>
                    )}
                    {r.developer_note && (
                      <div className="mt-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                        <p className="text-xs text-orange-300 font-medium mb-0.5">Response from our team</p>
                        <p className="text-xs text-orange-200/80">{r.developer_note}</p>
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-slate-600">
                  <span>{new Date(r.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}</span>
                  <span>·</span>
                  <span>{TYPE_LABEL[r.type] ?? r.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
