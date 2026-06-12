import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email'

// Receives applications from the noveliotech.com/careers Apply modal.
// Accepts multipart/form-data (so a resume file can come along) and stores the
// resume in the public crm-files bucket.

const ALLOWED_ORIGINS = [
  'https://noveliotech.com',
  'https://www.noveliotech.com',
  'http://localhost:5173',
]

const NOTIFY_TO = 'ajay@noveliotech.com'
const MAX_RESUME_BYTES = 5 * 1024 * 1024
const ALLOWED_RESUME_EXT = ['pdf', 'doc', 'docx']

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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  const headers = corsHeaders(origin)

  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.CRM_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }

  const form = await req.formData()
  const field = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v.trim() : ''
  }

  const name = field('name')
  const email = field('email').toLowerCase()
  const jobId = field('job_id')
  const jobTitle = field('job_title')

  if (!name || !jobTitle) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers })
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400, headers })
  }

  const supabase = createServiceClient()

  // Optional resume upload → public crm-files bucket
  let resumeUrl: string | null = null
  const resume = form.get('resume')
  if (resume instanceof File && resume.size > 0) {
    if (resume.size > MAX_RESUME_BYTES) {
      return NextResponse.json({ error: 'Resume too large (max 5 MB)' }, { status: 400, headers })
    }
    const ext = (resume.name.split('.').pop() ?? '').toLowerCase()
    if (!ALLOWED_RESUME_EXT.includes(ext)) {
      return NextResponse.json({ error: 'Resume must be PDF or Word' }, { status: 400, headers })
    }
    const safeName = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const path = `resumes/${Date.now()}-${safeName}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('crm-files')
      .upload(path, resume, { contentType: resume.type || 'application/octet-stream' })
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(path)
      resumeUrl = urlData.publicUrl
    }
  }

  const record = {
    job_id: jobId || null,
    job_title: jobTitle,
    name,
    email,
    phone: field('phone') || null,
    linkedin: field('linkedin') || null,
    cover: field('cover') || null,
    responsibilities: field('responsibilities') || null,
    seo_tasks: field('seo_tasks') || null,
    live_urls: field('live_urls') || null,
    results: field('results') || null,
    tools: field('tools') || null,
    resume_url: resumeUrl,
  }

  const { error } = await supabase.from('job_applications').insert(record)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers })
  }

  // Notify the hiring inbox; the application is already saved, so a mail
  // failure should not fail the request.
  const rows = Object.entries({
    'Job': jobTitle,
    'Name': name,
    'Email': email,
    'Phone': record.phone,
    'LinkedIn / Portfolio': record.linkedin,
    'Why this role': record.cover,
    'Responsibilities': record.responsibilities,
    'SEO tasks executed': record.seo_tasks,
    'Live URLs': record.live_urls,
    'Results achieved': record.results,
    'Tools used': record.tools,
    'Resume': resumeUrl,
  })
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(String(v))}</td></tr>`)
    .join('')

  sendEmail({
    to: NOTIFY_TO,
    subject: `New application: ${jobTitle} — ${name}`,
    html: `<h2 style="margin:0 0 12px">New job application</h2><table style="font-size:14px;border-collapse:collapse">${rows}</table><p style="margin-top:16px;font-size:13px;color:#64748b">Review it in the CRM → Careers page.</p>`,
  }).catch(() => {})

  return NextResponse.json({ success: true }, { status: 201, headers })
}
