import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { contractLinkExpired } from '@/lib/contract-expiry'

export async function GET(
  _req: NextRequest,
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
  if (contract.status === 'signed') return NextResponse.json({ signed: true, signed_pdf_url: contract.signed_pdf_url }, { status: 200 })
  if (contract.status === 'cancelled') return NextResponse.json({ error: 'Cancelled' }, { status: 410 })
  if (contractLinkExpired(contract)) return NextResponse.json({ error: 'Expired' }, { status: 410 })

  return NextResponse.json({ contract })
}
