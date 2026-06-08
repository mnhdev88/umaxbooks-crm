import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ error: 'Missing lead_id' }, { status: 400 })

  const service = createServiceClient()
  const { data } = await service
    .from('contracts')
    .select('id,status,business_name,client_email,package,total_amount,sent_at,signed_at,signed_pdf_url,signing_token')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ contracts: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'sales_agent') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { lead_id, ...fields } = body

  const service = createServiceClient()
  const { data: contract, error } = await service
    .from('contracts')
    .insert({ lead_id, created_by: user.id, ...fields })
    .select('id,signing_token,client_email,business_name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Send signing link email via default provider
  const { data: provider } = await service
    .from('email_providers')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  if (provider) {
    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin
    const signingUrl = `${origin}/sign/${contract.signing_token}`
    const agencyName = process.env.NEXT_PUBLIC_AGENCY_NAME || 'Novelio Technologies'
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(90deg,#1F3A93,#4a6cf7);height:5px;border-radius:4px 4px 0 0"></div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
          <h2 style="color:#1F3A93;margin:0 0 8px">Your Service Agreement is Ready</h2>
          <p style="color:#374151;margin:0 0 24px">Dear <strong>${contract.business_name}</strong>,</p>
          <p style="color:#374151;margin:0 0 24px">
            <strong>${agencyName}</strong> has prepared your service agreement. Please review and sign it by clicking the button below.
          </p>
          <p style="text-align:center;margin:32px 0">
            <a href="${signingUrl}" style="background:#1F3A93;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
              Review &amp; Sign Agreement
            </a>
          </p>
          <p style="color:#9ca3af;font-size:12px;margin:0">Or copy this link:<br>${signingUrl}</p>
          <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px;margin:0">${agencyName} · support@noveliotech.com</p>
        </div>
      </div>`

    try {
      if (provider.provider === 'resend') {
        const resend = new Resend(provider.api_key)
        await resend.emails.send({
          from: `${agencyName} <${provider.from_email}>`,
          to: [contract.client_email],
          subject: `Service Agreement – ${agencyName}`,
          html,
        })
      } else {
        const from = provider.provider === 'gmail' ? provider.username : provider.from_email
        const transporter = nodemailer.createTransport({
          host: provider.host, port: provider.port, secure: provider.secure,
          auth: { user: provider.username, pass: provider.password },
        })
        await transporter.sendMail({
          from: `${agencyName} <${from}>`,
          to: contract.client_email,
          subject: `Service Agreement – ${agencyName}`,
          html,
        })
      }
    } catch (e: any) {
      console.error('Contract email error:', e.message)
    }
  }

  await service.from('activity_logs').insert({
    lead_id,
    user_id: user.id,
    action: 'Contract Sent',
    details: `Service agreement sent to ${contract.client_email}`,
  })

  return NextResponse.json({ success: true })
}
