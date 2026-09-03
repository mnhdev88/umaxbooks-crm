import { cookies, headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import { readScopeItems, readSchedule } from '@/lib/contract-plan'
import { contractLinkExpired } from '@/lib/contract-expiry'
import { sanitizeSections, shareLinkState } from '@/lib/share-link'
import { shareCookieName, verifyShareCookie } from '@/lib/share-cookie'
import { ShareGate } from './ShareGate'
import { ShareView, type ShareData } from './ShareView'
import { Shell, Notice } from './Shell'

/**
 * /share/<token> — the client-facing page for one lead: proposal, service
 * agreement and SEO audit, no login.
 *
 * Read entirely with the service client (there is no session here) and
 * whitelisted from the auth redirect in proxy.ts. Everything the visitor can
 * reach is decided on this server: the token resolves to exactly one lead, and
 * `sections` decides which tabs exist at all — nothing is filtered in the
 * browser, and no storage URL is ever sent to it.
 */
export const dynamic = 'force-dynamic'

const SUPPORT_EMAIL = 'support@noveliotech.com'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params
  const service = createServiceClient()

  const { data: link } = await service
    .from('lead_share_links')
    .select('id, lead_id, sections, expires_at, revoked_at, view_count')
    .eq('token', token)
    .maybeSingle()

  if (!link) {
    return (
      <Shell>
        <Notice
          icon="🔍"
          title="Link Not Found"
          body="This link is invalid or has already been replaced. Please ask us for a new one."
        />
      </Shell>
    )
  }

  const state = shareLinkState(link)
  if (state !== 'active') {
    return (
      <Shell>
        <Notice
          icon={state === 'revoked' ? '🚫' : '⏳'}
          title={state === 'revoked' ? 'Link Closed' : 'Link Expired'}
          body={
            state === 'revoked'
              ? 'This link is no longer active. Please contact us and we will send a fresh one.'
              : 'This link has expired. Email us and we will send you a fresh one right away.'
          }
          email={SUPPORT_EMAIL}
        />
      </Shell>
    )
  }

  const { data: lead } = await service
    .from('leads')
    .select('company_name, name')
    .eq('id', link.lead_id)
    .maybeSingle()

  const business = lead?.company_name || 'your business'

  // ── Gate ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const verified = verifyShareCookie(token, cookieStore.get(shareCookieName(token))?.value)

  if (!verified) {
    return (
      <Shell>
        <ShareGate token={token} business={business} />
      </Shell>
    )
  }

  // ── Content ───────────────────────────────────────────────────────────────
  const sections = sanitizeSections(link.sections)

  const [{ data: contracts }, { data: audit }] = await Promise.all([
    service
      .from('contracts')
      .select('status, signing_token, package, project_name, start_date, delivery_timeline, payment_type, total_amount, scope_items, payment_schedule, signed_at, signed_pdf_url, sent_at, created_at')
      .eq('lead_id', link.lead_id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }),
    service
      .from('audits')
      .select('score, created_at, audit_short_pdf_url, audit_long_pdf_url, sitemap_pdf_url')
      .eq('lead_id', link.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const rows   = contracts || []
  const signed = rows.find(c => c.status === 'signed') || null
  // The newest agreement still awaiting signature, if its 7-day window is open.
  const open   = rows.find(c => c.status === 'sent' && !contractLinkExpired(c)) || null

  // Option A: the proposal IS the offer on the table — the agreement the rep has
  // already prepared, shown before the signature page rather than as a separate
  // document. An unsigned agreement is the live offer; once signed, the proposal
  // tab shows what was agreed.
  const offer = open || signed || rows[0] || null

  const data: ShareData = {
    token,
    business,
    contactName: lead?.name || null,
    sections,
    supportEmail: SUPPORT_EMAIL,
    proposal: offer && sections.includes('proposal') ? {
      package:          offer.package || null,
      projectName:      offer.project_name || null,
      startDate:        offer.start_date || null,
      deliveryTimeline: offer.delivery_timeline || null,
      paymentType:      offer.payment_type || null,
      totalAmount:      offer.total_amount != null ? Number(offer.total_amount) : null,
      scopeItems:       readScopeItems(offer.scope_items),
      schedule:         readSchedule(offer.payment_schedule),
      signUrl:          open ? `/sign/${open.signing_token}` : null,
      alreadySigned:    !open && !!signed,
    } : null,
    contract: sections.includes('contract') ? {
      signed:      !!signed,
      signedAt:    signed?.signed_at || null,
      package:     (signed || open)?.package || null,
      totalAmount: (signed || open)?.total_amount != null ? Number((signed || open)!.total_amount) : null,
      paymentType: (signed || open)?.payment_type || null,
      hasPdf:      !!signed?.signed_pdf_url,
      signUrl:     open ? `/sign/${open.signing_token}` : null,
      // An agreement was sent but its signing window has already closed.
      awaitingExpired: !open && !signed && rows.some(c => c.status === 'sent'),
    } : null,
    audit: audit && sections.includes('audit') ? {
      score:      audit.score ?? null,
      preparedAt: audit.created_at || null,
      hasShort:   !!audit.audit_short_pdf_url,
      hasLong:    !!audit.audit_long_pdf_url,
      hasSitemap: !!audit.sitemap_pdf_url,
    } : null,
  }

  // Record the visit. Best-effort and deliberately not awaited into the render
  // path's correctness: a failed log must never blank the client's page.
  const hdrs = await headers()
  await Promise.all([
    service.from('lead_share_views').insert({
      link_id:    link.id,
      section:    'page',
      ip:         hdrs.get('x-forwarded-for')?.split(',')[0].trim() || null,
      user_agent: hdrs.get('user-agent'),
    }),
    service.from('lead_share_links').update({
      view_count:     (link.view_count || 0) + 1,
      last_viewed_at: new Date().toISOString(),
    }).eq('id', link.id),
  ]).catch(() => {})

  return (
    <Shell wide>
      <ShareView data={data} />
    </Shell>
  )
}
