import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const ALLOWED_ORIGIN = 'https://noveliotech.com'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.NEWSLETTER_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders() })
  }

  const body = await req.json()
  const email = (body.email ?? '').trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400, headers: corsHeaders() })
  }

  // Extract first segment of email prefix as name (e.g. "john" from "john.doe@gmail.com")
  const prefix = email.split('@')[0].split(/[._-]/)[0]
  const name = prefix.charAt(0).toUpperCase() + prefix.slice(1)

  const supabase = createServiceClient()

  // Skip duplicate emails silently
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: 'Already subscribed' }, { status: 200, headers: corsHeaders() })
  }

  const { error } = await supabase.from('leads').insert({
    name,
    company_name: 'Newsletter Subscriber',
    email,
    source: 'Subscriber',
    status: 'New',
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
  }

  return NextResponse.json({ success: true }, { status: 201, headers: corsHeaders() })
}
