import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'

const IPINFO_TOKEN = 'cc7528fe4ebae3'

function extractIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

async function fetchGeo(ip: string) {
  if (!ip || ip === 'unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return {}
  }
  try {
    const r = await fetch(`https://api.ipinfo.io/lite/${ip}?token=${IPINFO_TOKEN}`, {
      next: { revalidate: 0 },
    })
    if (!r.ok) return {}
    return await r.json()
  } catch {
    return {}
  }
}

/** Client calls this GET to get IP + geo before generating the PDF */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip  = extractIp(req)
  const geo = await fetchGeo(ip)

  return NextResponse.json({
    ip:       ip === 'unknown' ? 'Recorded' : ip,
    city:     geo.city     || '',
    region:   geo.region   || '',
    country:  geo.country  || '',
    isp:      geo.org      || '',
    timezone: geo.timezone || '',
    loc:      geo.loc      || '',
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const service = createServiceClient()

  const { data: contract } = await service
    .from('contracts')
    .select('*')
    .eq('signing_token', token)
    .single()

  if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (contract.status === 'signed') return NextResponse.json({ error: 'Already signed' }, { status: 400 })

  const body = await req.json()
  const {
    name_on_card, card_type, card_last_4,
    first_payment, installment_payment, balance_payment,
    client_full_name, client_sign_date, client_signature,
    pdf_base64,
    client_meta, // { timezone, screen, language, browser, signed_at_utc }
  } = body

  const clientIp  = extractIp(req)
  const userAgent = req.headers.get('user-agent') || ''
  const acceptLang = req.headers.get('accept-language') || ''

  // Geo lookup (parallel with other work)
  const geoPromise = fetchGeo(clientIp)

  // Upload signed PDF to Supabase Storage
  let signed_pdf_url: string | null = null
  if (pdf_base64) {
    try {
      const pdfBuffer = Buffer.from(pdf_base64, 'base64')
      const path = `signed/${contract.id}.pdf`
      const { error: upErr } = await service.storage
        .from('contracts')
        .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      if (!upErr) {
        const { data: { publicUrl } } = service.storage.from('contracts').getPublicUrl(path)
        signed_pdf_url = publicUrl
      }
    } catch { /* best-effort */ }
  }

  const geo = await geoPromise
  const location = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || ''

  const signing_metadata = {
    ip:           clientIp,
    user_agent:   userAgent,
    browser:      client_meta?.browser || userAgent,
    timezone:     client_meta?.timezone || geo.timezone || '',
    language:     client_meta?.language || acceptLang,
    screen:       client_meta?.screen  || '',
    signed_at_utc: client_meta?.signed_at_utc || new Date().toISOString(),
    geo: {
      city:    geo.city    || '',
      region:  geo.region  || '',
      country: geo.country || '',
      isp:     geo.org     || '',
      timezone:geo.timezone|| '',
      loc:     geo.loc     || '',
    },
  }

  await Promise.all([
    service.from('contracts').update({
      status: 'signed',
      name_on_card, card_type, card_last_4,
      first_payment:       first_payment       || null,
      installment_payment: installment_payment || null,
      balance_payment:     balance_payment     || null,
      client_full_name, client_sign_date, client_signature,
      client_ip:        clientIp,
      signing_metadata,
      signed_at:        new Date().toISOString(),
      signed_pdf_url,
    }).eq('id', contract.id),
    service.from('leads').update({ status: 'Closed Won' }).eq('id', contract.lead_id),
  ])

  await service.from('activity_logs').insert({
    lead_id:  contract.lead_id,
    user_id:  contract.created_by,
    action:   'Contract Signed',
    details:  `Agreement signed by ${client_full_name || contract.client_email} (IP: ${clientIp}${location ? ` · ${location}` : ''})`,
  })

  // Send confirmation emails
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (provider) {
    const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'
    const origin     = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://crm.noveliotech.com'
    const viewUrl    = `${origin}/sign/${token}`

    const pdfBtn = signed_pdf_url
      ? `<p style="text-align:center;margin:8px 0">
           <a href="${signed_pdf_url}" style="background:#1F3A93;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
             ⬇ Download Signed Agreement (PDF)
           </a>
         </p>`
      : ''

    const viewBtn = `<p style="text-align:center;margin:8px 0">
        <a href="${viewUrl}" style="background:#f8f9fd;color:#1F3A93;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;border:1.5px solid #1F3A93">
          View Signed Agreement
        </a>
      </p>`

    const clientHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(90deg,#1F3A93,#4a6cf7);height:5px;border-radius:4px 4px 0 0"></div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
          <h2 style="color:#1F3A93;margin:0 0 16px">Agreement Signed – Thank You!</h2>
          <p style="color:#374151;margin:0 0 8px">Dear <strong>${contract.business_name}</strong>,</p>
          <p style="color:#374151;margin:0 0 24px">
            Your service agreement with <strong>${agencyName}</strong> has been signed successfully on <strong>${client_sign_date}</strong>.
            Your signed copy is available using the buttons below.
          </p>
          ${pdfBtn}
          ${viewBtn}
          <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0">
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
            <tr><td style="padding:4px 0;color:#9ca3af;width:120px">Package</td><td>${contract.package || '—'}</td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af">Total Amount</td><td><strong>$${contract.total_amount || '0'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af">Start Date</td><td>${contract.start_date || '—'}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">${agencyName} · support@noveliotech.com</p>
        </div>
      </div>`

    const parsedBrowser = parseBrowserUA(userAgent)
    const adminHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#065f46;margin:0 0 16px">✅ Contract Signed</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#6b7280;width:160px">Business</td><td style="color:#111"><strong>${contract.business_name}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Signed by</td><td style="color:#111">${client_full_name}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Email</td><td style="color:#111">${contract.client_email}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Package</td><td style="color:#111">${contract.package || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Amount</td><td style="color:#111">$${contract.total_amount || '0'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Date Signed</td><td style="color:#111">${client_sign_date}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">IP Address</td><td style="color:#111"><code>${clientIp}</code></td></tr>
          ${location ? `<tr><td style="padding:6px 0;color:#6b7280">Location</td><td style="color:#111">${location}</td></tr>` : ''}
          ${geo.org ? `<tr><td style="padding:6px 0;color:#6b7280">ISP</td><td style="color:#111">${geo.org}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#6b7280">Browser / OS</td><td style="color:#111">${parsedBrowser}</td></tr>
          ${signing_metadata.timezone ? `<tr><td style="padding:6px 0;color:#6b7280">Timezone</td><td style="color:#111">${signing_metadata.timezone}</td></tr>` : ''}
          ${signing_metadata.screen ? `<tr><td style="padding:6px 0;color:#6b7280">Screen</td><td style="color:#111">${signing_metadata.screen}</td></tr>` : ''}
        </table>
        <div style="margin-top:20px">
          ${pdfBtn}
          ${viewBtn}
        </div>
      </div>`

    try {
      const { data: adminProfile } = await service
        .from('profiles').select('email').eq('id', contract.created_by).single()

      if (provider.provider === 'resend') {
        const resend = new Resend(provider.api_key)
        await Promise.all([
          resend.emails.send({ from: `${agencyName} <${provider.from_email}>`, to: [contract.client_email], subject: `Signed Agreement – ${agencyName}`, html: clientHtml }),
          adminProfile?.email
            ? resend.emails.send({ from: `${agencyName} <${provider.from_email}>`, to: [adminProfile.email], subject: `Contract Signed: ${contract.business_name}`, html: adminHtml })
            : Promise.resolve(),
        ])
      } else {
        const from = provider.provider === 'gmail' ? provider.username : provider.from_email
        const t = nodemailer.createTransport({ host: provider.host, port: provider.port, secure: provider.secure, auth: { user: provider.username, pass: provider.password } })
        await Promise.all([
          t.sendMail({ from: `${agencyName} <${from}>`, to: contract.client_email, subject: `Signed Agreement – ${agencyName}`, html: clientHtml }),
          adminProfile?.email
            ? t.sendMail({ from: `${agencyName} <${from}>`, to: adminProfile.email, subject: `Contract Signed: ${contract.business_name}`, html: adminHtml })
            : Promise.resolve(),
        ])
      }
    } catch (e: any) {
      console.error('Contract sign email error:', e.message)
    }
  }

  return NextResponse.json({ success: true, signed_pdf_url })
}

function parseBrowserUA(ua: string): string {
  if (!ua) return 'Unknown'
  let browser = 'Unknown'
  let os = 'Unknown OS'

  if (ua.includes('Edg/') || ua.includes('Edge/')) browser = 'Edge'
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'

  if (ua.includes('Windows NT 10.0') || ua.includes('Windows NT 11.0')) os = 'Windows 10/11'
  else if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('iPhone')) os = 'iPhone (iOS)'
  else if (ua.includes('iPad')) os = 'iPad (iOS)'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('Mac OS X')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'

  return `${browser} on ${os}`
}
