import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const ALLOWED_ORIGINS = [
  'https://noveliotech.com',
  'https://www.noveliotech.com',
  'http://localhost:5173',
]

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  const headers = corsHeaders(origin)

  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.NEWSLETTER_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }

  const body = await req.json()
  const email = (body.email ?? '').trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400, headers })
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
    return NextResponse.json({ message: 'Already subscribed' }, { status: 200, headers })
  }

  const { error } = await supabase.from('leads').insert({
    name,
    company_name: 'Newsletter Subscriber',
    email,
    source: 'Subscriber',
    status: 'New',
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers })
  }

  return NextResponse.json({ success: true }, { status: 201, headers })
}
