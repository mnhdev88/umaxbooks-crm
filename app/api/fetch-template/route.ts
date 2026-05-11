import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 502 })
    const html = await res.text()
    return NextResponse.json({ html })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch template' }, { status: 502 })
  }
}
