import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { slugify } from '@/lib/utils'
import { LEAD_SOURCES, type LeadSource } from '@/types'

// "New email" in the Emails inbox.
//   POST { action: 'lookup', email }  → the existing lead for that address (primary or alternate), or null
//   POST { action: 'create', email, company_name, name, phone?, website_url?, source? }
//        → creates a lead assigned to the sender with status Contacted, so the email
//          (and every reply, via the Gmail sync) is tracked on it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface LeadOut {
  id: string
  name: string | null
  company_name: string | null
  email: string | null
  alt_emails: { value: string; label?: string }[] | null
  assigned_agent_id: string | null
  assignee?: { full_name: string } | null
}

async function findLead(email: string): Promise<LeadOut | null> {
  // Service client: an agent emailing an address must find the lead even when
  // it's assigned to someone else, so the mail attaches there instead of duplicating it.
  const service = createServiceClient()
  const { data: matches } = await service.rpc('match_leads_by_emails', { p_emails: [email] })
  const leadId = (matches as { lead_id: string }[] | null)?.[0]?.lead_id
  if (!leadId) return null
  const { data } = await service
    .from('leads')
    .select('id, name, company_name, email, alt_emails, assigned_agent_id, assignee:assigned_agent_id(full_name)')
    .eq('id', leadId)
    .single()
  return (data as unknown as LeadOut) || null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || !['admin', 'agent', 'sales_agent', 'sales_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })

  if (body.action === 'lookup') {
    return NextResponse.json({ lead: await findLead(email) })
  }

  if (body.action !== 'create') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const company = String(body.company_name || '').trim()
  const name = String(body.name || '').trim()
  if (!company || !name) {
    return NextResponse.json({ error: 'Company and contact name are required' }, { status: 400 })
  }

  // Someone may have added this address meanwhile — attach to that lead instead
  const existing = await findLead(email)
  if (existing) return NextResponse.json({ lead: existing, existed: true })

  const phone = String(body.phone || '').trim() || null
  const website = String(body.website_url || '').trim() || null
  const source: LeadSource = LEAD_SOURCES.includes(body.source) ? body.source : 'Other'

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      name,
      company_name: company,
      email,
      phone,
      website_url: website,
      source,
      status: 'Contacted',
      assigned_agent_id: user.id, // set explicitly, so the round-robin trigger leaves it alone
      created_by: user.id,
      slug: `${slugify(company) || 'lead'}-${Date.now()}`,
    })
    .select('id, name, company_name, email, alt_emails, assigned_agent_id')
    .single()

  if (error) {
    if (error.code === '23505' && /phone/i.test(error.message)) {
      const service = createServiceClient()
      const { data: dup } = await service.from('leads').select('company_name').ilike('phone', phone || '').maybeSingle()
      return NextResponse.json(
        { error: `That phone number already belongs to ${dup?.company_name || 'another lead'}. Leave phone empty or use the existing lead.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.from('activity_logs').insert({
    lead_id: lead.id,
    user_id: user.id,
    action: 'Lead Created',
    details: `Lead created for ${company} from the Emails inbox (new email to ${email})`,
  })

  return NextResponse.json({ lead: { ...lead, assignee: { full_name: profile.full_name } }, created: true })
}
