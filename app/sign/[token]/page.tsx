import { createServiceClient } from '@/lib/supabase/service'
import { SigningForm } from './SigningForm'
import { readSchedule, prettyDate, usd } from '@/lib/contract-plan'
import { contractLinkExpired, CONTRACT_LINK_DAYS } from '@/lib/contract-expiry'

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

  // A sent link only lives so long — after that the client must ask for a fresh
  // agreement rather than sign week-old terms.
  if (contractLinkExpired(contract)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3fa', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 40px rgba(31,58,147,.13)', maxWidth: '380px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <h2 style={{ color: '#6b7280', marginBottom: '8px' }}>Signing Link Expired</h2>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            This agreement was valid for {CONTRACT_LINK_DAYS} days and has expired.
            Please contact us at <a href="mailto:support@noveliotech.com" style={{ color: '#1F3A93' }}>support@noveliotech.com</a> and
            we&apos;ll send you a fresh agreement.
          </p>
        </div>
      </div>
    )
  }

  if (contract.status === 'signed') {
    return (
      <div style={{ minHeight: '100vh', background: '#f1f3fa', fontFamily: "'DM Sans', sans-serif", padding: '40px 16px' }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <div style={{ maxWidth: '640px', margin: '0 auto', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 40px rgba(31,58,147,.13)', overflow: 'hidden' }}>
          <div style={{ height: '5px', background: 'linear-gradient(90deg,#1F3A93,#4a6cf7,#b8902a)' }} />
          <div style={{ padding: '40px 36px' }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{ fontSize: '52px', marginBottom: '12px' }}>✅</div>
              <h2 style={{ color: '#065f46', fontSize: '22px', fontWeight: 700, margin: '0 0 8px' }}>Agreement Signed</h2>
              <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>This service agreement has been signed. Thank you for your business!</p>
            </div>

            {/* Agreement details */}
            <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '14px' }}>Agreement Details</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <tbody>
                  {[
                    ['Business', contract.business_name],
                    ['Contact', contract.contact_person],
                    ['Package', contract.package],
                    ['Total Amount', contract.total_amount ? `$${Number(contract.total_amount).toFixed(2)}` : null],
                    ['Payment Type', contract.payment_type],
                    ['Start Date', contract.start_date],
                    ['Signed by', contract.client_full_name],
                    ['Date Signed', contract.client_sign_date],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <tr key={String(label)}>
                      <td style={{ padding: '5px 0', color: '#9ca3af', width: '130px', verticalAlign: 'top' }}>{label}</td>
                      <td style={{ padding: '5px 0', color: '#111', fontWeight: 500 }}>{String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Agreed payment schedule */}
            {readSchedule(contract.payment_schedule).length > 0 && (
              <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: '14px' }}>Payment Schedule</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <tbody>
                    {readSchedule(contract.payment_schedule).map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: '5px 0', color: '#374151' }}>{row.label}</td>
                        <td style={{ padding: '5px 0', color: '#9ca3af', whiteSpace: 'nowrap' }}>{prettyDate(row.due_date)}</td>
                        <td style={{ padding: '5px 0', color: '#111', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{usd(Number(row.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Download / view buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {contract.signed_pdf_url && (
                <a
                  href={contract.signed_pdf_url}
                  target="_blank"
                  style={{ display: 'block', textAlign: 'center', background: '#1F3A93', color: '#fff', padding: '13px 28px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}
                >
                  ⬇ Download Signed Agreement (PDF)
                </a>
              )}
              {!contract.signed_pdf_url && (
                <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '13px', background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                  Your signed agreement is on record with Novelio Technologies LLC.<br />
                  Contact <a href="mailto:support@noveliotech.com" style={{ color: '#1F3A93' }}>support@noveliotech.com</a> for a copy.
                </p>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', padding: '16px 32px 24px', borderTop: '1px solid #f0f0f0' }}>
            <strong>Novelio Technologies LLC</strong> · 8 The Green STE A, Dover, DE 19901 · support@noveliotech.com
          </div>
        </div>
      </div>
    )
  }

  return <SigningForm contract={contract} token={token} />
}
