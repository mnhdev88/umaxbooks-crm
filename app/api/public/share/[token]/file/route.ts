import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sanitizeSections, shareLinkState } from '@/lib/share-link'
import { shareCookieName, verifyShareCookie } from '@/lib/share-cookie'

/**
 * GET /api/public/share/<token>/file?kind=audit_short — serve a document to a
 * verified share-link visitor.
 *
 * The point of this route is that the client never receives a storage URL.
 * Files in crm-files and contracts are served from PUBLIC buckets, so anything
 * we hand out directly stays readable by anyone who has the URL, forever —
 * revoking the share link would revoke nothing. Streaming the bytes through
 * here means access ends the moment the link is revoked, expires, or the
 * section is unticked.
 *
 * Requires the gate cookie for this exact token; kinds are mapped to the
 * section that must be enabled on the link.
 */
const KIND_SECTION = {
  audit_short:  'audit',
  audit_long:   'audit',
  sitemap:      'audit',
  contract_pdf: 'contract',
} as const

type Kind = keyof typeof KIND_SECTION

/** Split a Supabase public object URL back into its bucket and object path. */
function parseStorageUrl(url: string | null | undefined): { bucket: string; path: string } | null {
  const m = String(url || '').match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/)
  if (!m) return null
  return { bucket: m[1], path: decodeURIComponent(m[2].split('?')[0]) }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const kind = req.nextUrl.searchParams.get('kind') as Kind | null

  if (!kind || !(kind in KIND_SECTION)) {
    return NextResponse.json({ error: 'Unknown document' }, { status: 400 })
  }

  const cookie = req.cookies.get(shareCookieName(token))?.value
  if (!verifyShareCookie(token, cookie)) {
    return NextResponse.json({ error: 'Not verified' }, { status: 401 })
  }

  const service = createServiceClient()

  const { data: link } = await service
    .from('lead_share_links')
    .select('id, lead_id, sections, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle()

  if (!link || shareLinkState(link) !== 'active') {
    return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 })
  }

  if (!sanitizeSections(link.sections).includes(KIND_SECTION[kind])) {
    return NextResponse.json({ error: 'Not available on this link' }, { status: 403 })
  }

  // Resolve the kind to a stored URL.
  let url: string | null = null
  if (kind === 'contract_pdf') {
    const { data: contract } = await service
      .from('contracts')
      .select('signed_pdf_url')
      .eq('lead_id', link.lead_id)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    url = contract?.signed_pdf_url ?? null
  } else {
    const { data: audit } = await service
      .from('audits')
      .select('audit_short_pdf_url, audit_long_pdf_url, sitemap_pdf_url')
      .eq('lead_id', link.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    url = (kind === 'audit_short' ? audit?.audit_short_pdf_url
        :  kind === 'audit_long'  ? audit?.audit_long_pdf_url
        :                           audit?.sitemap_pdf_url) ?? null
  }

  const ref = parseStorageUrl(url)
  if (!ref) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: blob, error } = await service.storage.from(ref.bucket).download(ref.path)
  if (error || !blob) {
    console.error('[share/file] download failed', ref.bucket, ref.path, error?.message)
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  await service.from('lead_share_views').insert({
    link_id:    link.id,
    section:    kind,
    ip:         req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
    user_agent: req.headers.get('user-agent'),
  })

  const filename = ref.path.split('/').pop() || 'document.pdf'

  return new NextResponse(blob.stream() as unknown as ReadableStream, {
    headers: {
      'Content-Type':        blob.type || 'application/pdf',
      // inline: phone browsers open it in the built-in viewer instead of
      // dumping it in Downloads, which is what a client expects from a link.
      'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
