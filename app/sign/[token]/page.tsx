import { createServiceClient } from '@/lib/supabase/service'
import { SigningForm } from './SigningForm'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SigningPage({ params }: PageProps) {
  const { token } = await params
  const service   = createServiceClient()

  const { data: contract } = await service
    .from('contracts')
    .select('*')
    .eq('signing_token', token)
    .single()

  if (!contract) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3fa', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 40px rgba(31,58,147,.13)', maxWidth: '380px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
          <h2 style={{ color: '#1F3A93', marginBottom: '8px' }}>Agreement Not Found</h2>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>This link is invalid or has expired.</p>
        </div>
      </div>
    )
  }

  if (contract.status === 'cancelled') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3fa', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 40px rgba(31,58,147,.13)', maxWidth: '380px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</div>
          <h2 style={{ color: '#6b7280', marginBottom: '8px' }}>Agreement Cancelled</h2>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>This agreement is no longer active. Please contact us.</p>
        </div>
      </div>
    )
  }

  if (contract.status === 'signed') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3fa', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 40px rgba(31,58,147,.13)', maxWidth: '420px' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ color: '#065f46', marginBottom: '8px' }}>Agreement Already Signed</h2>
          <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '24px' }}>This service agreement has been signed. Thank you for your business!</p>
          {contract.signed_pdf_url && (
            <a
              href={contract.signed_pdf_url}
              target="_blank"
              style={{ display: 'inline-block', background: '#1F3A93', color: '#fff', padding: '12px 28px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}
            >
              Download Signed Agreement
            </a>
          )}
        </div>
      </div>
    )
  }

  return <SigningForm contract={contract} token={token} />
}
