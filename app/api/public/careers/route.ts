import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Public job-postings feed for noveliotech.com/careers.
// Lives under /api/public so the proxy's existing whitelist lets it through.

const ALLOWED_ORIGINS = [
  'https://noveliotech.com',
  'https://www.noveliotech.com',
  'http://localhost:5173',
]

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300',
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  const headers = corsHeaders(origin)

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('job_postings')
    .select('id, title, region, openings, job_location, shift, description, pills, apply_note_title, apply_note_points, apply_note_footer, footer_note, btn_label')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers })
  }

  return NextResponse.json({ jobs: data ?? [] }, { headers })
}
