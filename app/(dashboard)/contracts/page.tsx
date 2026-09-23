import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { getCurrentProfile } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { contractOwnerIds, contractInScope, CONTRACT_PAGE_ROLES } from '@/lib/contract-access'
import { ContractsClient, type ContractRow } from '@/components/contracts/ContractsClient'

const COLUMNS = [
  'id, lead_id, status, business_name, client_email, package, total_amount',
  'sent_at, signed_at, created_at, signed_pdf_url, signing_token, created_by',
  'lead:leads(company_name, lead_number, assigned_agent_id)',
  'sender:profiles!contracts_created_by_fkey(full_name)',
].join(', ')

export default async function ContractsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!CONTRACT_PAGE_ROLES.includes(profile.role)) redirect('/')

  // Service client + contract-access scoping rather than RLS: the contracts SELECT
  // policies predate sales_manager and only know "admin" and "agent's own lead".
  const service = createServiceClient()
  const owners  = await contractOwnerIds(service, profile)

  // Batched — PostgREST caps a select at 1000 rows.
  const rows: any[] = []
  let loadError = ''
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service
      .from('contracts')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) { loadError = error.message; break }
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  const contracts: ContractRow[] = rows
    .filter(r => contractInScope(owners, { created_by: r.created_by, lead_owner: r.lead?.assigned_agent_id ?? null }))
    .map(r => ({
      id:             r.id,
      lead_id:        r.lead_id,
      status:         r.status,
      business_name:  r.business_name,
      client_email:   r.client_email,
      package:        r.package,
      total_amount:   r.total_amount,
      sent_at:        r.sent_at,
      signed_at:      r.signed_at,
      created_at:     r.created_at,
      signed_pdf_url: r.signed_pdf_url,
      signing_token:  r.signing_token,
      lead_name:      r.lead?.company_name ?? null,
      lead_number:    r.lead?.lead_number ?? null,
      sender_name:    r.sender?.full_name ?? null,
    }))

  return (
    <>
      <Header title="Contracts" profile={profile as Profile} />
      <div className="p-6">
        <ContractsClient contracts={contracts} loadError={loadError} />
      </div>
    </>
  )
}
