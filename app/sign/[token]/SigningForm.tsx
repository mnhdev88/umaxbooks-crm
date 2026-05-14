'use client'

import { useRef, useState, useEffect } from 'react'

const CSS = `
#nva *,#nva *::before,#nva *::after{box-sizing:border-box;margin:0;padding:0}
#nva{font-family:'DM Sans',sans-serif;font-size:15px;color:#111;background:#f1f3fa;padding:40px 16px 60px;min-height:100vh}
#nva .box{max-width:800px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(31,58,147,.13);overflow:hidden}
#nva .top-bar{height:5px;background:linear-gradient(90deg,#1F3A93,#4a6cf7,#b8902a)}
#nva .head{text-align:center;padding:32px 32px 24px;border-bottom:1px solid #eee}
#nva .head h1{font-size:22px;font-weight:700;color:#1F3A93;margin-bottom:6px}
#nva .head p{font-size:13px;color:#6b7280}
#nva .sec{padding:24px 32px;border-bottom:1px solid #f0f0f0}
#nva .sec-title{font-size:13px;font-weight:700;color:#1F3A93;text-transform:uppercase;letter-spacing:.6px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #eef1fb}
#nva .row{display:grid;gap:14px;margin-bottom:14px}
#nva .row.c2{grid-template-columns:1fr 1fr}
#nva .row.c3{grid-template-columns:1fr 1fr 1fr}
#nva label{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px}
#nva .req{color:#e53e3e}
#nva input,#nva select{width:100%;padding:10px 12px;font-family:'DM Sans',sans-serif;font-size:14px;color:#111;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;outline:none;transition:.15s;appearance:none;-webkit-appearance:none}
#nva input:focus,#nva select:focus{border-color:#1F3A93;box-shadow:0 0 0 3px rgba(31,58,147,.1);background:#fff}
#nva input[readonly],#nva input.readonly{background:#f3f4f6;color:#4b5563;cursor:default;border-color:#e5e7eb}
#nva .cbadges{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
#nva .cbadge{padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:.4px;border:1.5px solid #e5e7eb;color:#9ca3af;background:#f9fafb;cursor:pointer;transition:.15s;user-select:none}
#nva .cbadge.on{background:#1F3A93;color:#fff;border-color:#1F3A93}
#nva .policy{font-size:13px;color:#374151;line-height:1.8;background:#f9fafb;border-radius:8px;padding:14px 16px}
#nva .policy ul{padding-left:18px;margin-top:8px}
#nva .policy li{margin-bottom:5px}
#nva .checks{display:flex;flex-direction:column;gap:8px}
#nva .chk{display:flex;align-items:flex-start;gap:11px;padding:11px 14px;border-radius:8px;border:1.5px solid #e5e7eb;background:#fafafa;cursor:pointer;transition:.15s;user-select:none}
#nva .chk:hover,#nva .chk.on{border-color:#1F3A93;background:#eef1fb}
#nva .chk-box{width:18px;height:18px;flex-shrink:0;border:2px solid #d1d5db;border-radius:4px;background:#fff;display:flex;align-items:center;justify-content:center;margin-top:1px;transition:.15s}
#nva .chk.on .chk-box{background:#1F3A93;border-color:#1F3A93}
#nva .chk.on .chk-box::after{content:'';display:block;width:5px;height:9px;border:2px solid #fff;border-top:none;border-left:none;transform:rotate(45deg) translate(-1px,-1px)}
#nva .chk-txt{font-size:13.5px;color:#374151;line-height:1.5}
#nva .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
#nva .sig-head{font-size:13px;font-weight:600;color:#374151;margin-bottom:8px}
#nva canvas{display:block;width:100%;height:110px;border:1.5px dashed #d1d5db;border-radius:8px;background:#f9fafb;cursor:crosshair;touch-action:none}
#nva canvas.signed{border-style:solid;border-color:#1F3A93;background:#fff}
#nva .rep-sig-img{width:100%;height:110px;border:1.5px solid #1F3A93;border-radius:8px;background:#fff;object-fit:contain;padding:4px}
#nva .rep-sig-text{margin-top:8px;font-size:12px;color:#374151;line-height:1.6}
#nva .clr{margin-top:6px;padding:5px 12px;font-size:12px;font-family:'DM Sans',sans-serif;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#9ca3af;cursor:pointer;transition:.15s}
#nva .clr:hover{border-color:#e53e3e;color:#e53e3e;background:#fff5f5}
#nva .actions{padding:20px 32px;background:#f8f9fd;border-top:1px solid #eee;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#nva .btn{display:inline-flex;align-items:center;gap:7px;padding:11px 22px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:.2s}
#nva .btn:disabled{opacity:.5;cursor:not-allowed}
#nva .btn-blue{background:#1F3A93;color:#fff;border-color:#1F3A93;box-shadow:0 4px 14px rgba(31,58,147,.25)}
#nva .btn-blue:hover:not(:disabled){background:#152b70;transform:translateY(-1px)}
#nva .msg{margin:0 32px 16px;padding:13px 16px;border-radius:8px;font-size:13.5px;font-weight:500;display:none;align-items:center;gap:9px}
#nva .msg.show{display:flex}
#nva .msg.ok{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
#nva .msg.err{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
#nva .spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}
#nva .foot{text-align:center;font-size:12px;color:#9ca3af;padding:16px 32px 24px;line-height:1.8}
#nva .signed-badge{display:inline-flex;align-items:center;gap:6px;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600}
@media(max-width:580px){#nva .row.c2,#nva .row.c3,#nva .sig-grid{grid-template-columns:1fr}#nva .sec,#nva .actions,#nva .msg{padding-left:18px;padding-right:18px}}
`

const ACKS = [
  'I confirm the payment details provided above are correct.',
  'I confirm I have full knowledge of this payment for the selected services.',
  'I understand the service scope, refund policy, and support terms.',
  'I understand hosting and SSL renewal charges apply after the first year.',
  'I understand additional work outside the agreed scope may be chargeable.',
  'I agree to the published policies and service guidelines of Novelio Technologies LLC.',
]

const CARD_TYPES = ['Visa', 'Mastercard', 'Amex', 'Discover']

declare global {
  interface Window { html2pdf: any }
}

export function SigningForm({ contract, token }: { contract: any; token: string }) {
  const today = new Date().toISOString().split('T')[0]

  const [payment, setPayment] = useState({
    name_on_card:        '',
    card_type:           '',
    card_last_4:         '',
    first_payment:       '',
    installment_payment: '',
    balance_payment:     '',
    client_full_name:    '',
    client_sign_date:    today,
  })

  const [acks,     setAcks]     = useState<boolean[]>(Array(6).fill(false))
  const [hasSig,   setHasSig]   = useState(false)
  const [drawing,  setDrawing]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)
  const [pdfUrl,   setPdfUrl]   = useState<string | null>(null)

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const contractRef = useRef<HTMLDivElement>(null)

  // Load html2pdf.js from CDN
  useEffect(() => {
    if (window.html2pdf) return
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
    document.head.appendChild(s)
  }, [])

  // Init canvas
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const resize = () => { if (c.offsetWidth > 0) c.width = c.offsetWidth }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return [s.clientX - r.left, s.clientY - r.top]
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    setDrawing(true)
    const [x, y] = getPos(e)
    ctx.beginPath(); ctx.moveTo(x, y)
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!drawing) return
    const ctx = canvasRef.current!.getContext('2d')!
    const [x, y] = getPos(e)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#1F3A93'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    ctx.stroke()
    setHasSig(true)
  }

  function clearSig() {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setHasSig(false)
  }

  function setP(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setPayment(p => ({ ...p, [k]: e.target.value }))
  }

  function toggleAck(i: number) {
    setAcks(a => a.map((v, idx) => idx === i ? !v : v))
  }

  async function handleSubmit() {
    setError('')

    if (!payment.name_on_card)    return setError('Please enter the name on card.')
    if (!payment.card_type)       return setError('Please select a card type.')
    if (!payment.card_last_4 || payment.card_last_4.length !== 4) return setError('Please enter the last 4 digits of your card.')
    if (!payment.first_payment)   return setError('Please enter the first payment amount.')
    if (!payment.client_full_name) return setError('Please enter your full legal name.')
    if (!acks.every(Boolean))     return setError('Please check all acknowledgment boxes.')
    if (!hasSig)                  return setError('Please draw your signature.')

    const client_signature = canvasRef.current!.toDataURL('image/png')
    setSubmitting(true)

    try {
      // Generate PDF from the contract div
      let pdf_base64: string | null = null
      if (window.html2pdf && contractRef.current) {
        const blob: Blob = await window.html2pdf().set({
          margin:     [8, 8, 8, 8],
          filename:   `Novelio-Agreement-${contract.business_name}.pdf`,
          image:      { type: 'jpeg', quality: 0.95 },
          html2canvas:{ scale: 2, useCORS: true, logging: false },
          jsPDF:      { unit: 'mm', format: 'a4', orientation: 'portrait' },
        }).from(contractRef.current).outputPdf('blob')

        pdf_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload  = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      }

      const res = await fetch(`/api/contracts/${token}/sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payment,
          first_payment:       parseFloat(payment.first_payment)       || null,
          installment_payment: parseFloat(payment.installment_payment) || null,
          balance_payment:     parseFloat(payment.balance_payment)     || null,
          client_signature,
          pdf_base64,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')

      setPdfUrl(data.signed_pdf_url)
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
        <div id="nva">
          <div className="box" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>✅</div>
            <h2 style={{ color: '#065f46', fontSize: '24px', marginBottom: '12px' }}>Agreement Signed Successfully!</h2>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>
              Thank you, <strong>{payment.client_full_name}</strong>. Your service agreement with Novelio Technologies LLC has been signed.
            </p>
            <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '32px' }}>
              A confirmation email has been sent to <strong>{contract.client_email}</strong>.
            </p>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                style={{ display: 'inline-block', background: '#1F3A93', color: '#fff', padding: '14px 32px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}
              >
                Download Signed Agreement (PDF)
              </a>
            )}
          </div>
        </div>
      </>
    )
  }

  const fmt = (v: any) => v || ''

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      <div id="nva">
        <div className="box" id="nva-card" ref={contractRef}>
          <div className="top-bar" />

          {/* Header */}
          <div className="head">
            <h1>Website &amp; Digital Services Agreement</h1>
            <p><strong>Novelio Technologies LLC</strong> &nbsp;·&nbsp; 8 The Green STE A, Dover, DE 19901 &nbsp;·&nbsp; +1-609-325-2541 &nbsp;·&nbsp; support@noveliotech.com</p>
            <p style={{ marginTop: '8px', fontSize: '13px', color: '#374151', fontStyle: 'italic' }}>
              This agreement is entered into by and between Novelio Technologies LLC and the undersigned client. By signing below, the Client agrees to all terms set forth herein.
            </p>
          </div>

          {/* 1 Client Info — pre-filled, read-only */}
          <div className="sec">
            <div className="sec-title">1 · Client Information</div>
            <div className="row c2">
              <div><label>Business Name</label><input readOnly className="readonly" value={fmt(contract.business_name)} /></div>
              <div><label>Contact Person</label><input readOnly className="readonly" value={fmt(contract.contact_person)} /></div>
            </div>
            <div className="row">
              <div><label>Billing Address</label><input readOnly className="readonly" value={fmt(contract.address)} /></div>
            </div>
            <div className="row c3">
              <div><label>City</label><input readOnly className="readonly" value={fmt(contract.city)} /></div>
              <div><label>State</label><input readOnly className="readonly" value={fmt(contract.state)} /></div>
              <div><label>ZIP</label><input readOnly className="readonly" value={fmt(contract.zip_code)} /></div>
            </div>
            <div className="row c2">
              <div><label>Contact Number</label><input readOnly className="readonly" value={fmt(contract.phone)} /></div>
              <div><label>Email Address</label><input readOnly className="readonly" value={fmt(contract.client_email)} /></div>
            </div>
          </div>

          {/* 2 Service Details — pre-filled, read-only */}
          <div className="sec">
            <div className="sec-title">2 · Service Details</div>
            <div className="row">
              <div><label>Selected Package</label><input readOnly className="readonly" value={fmt(contract.package)} /></div>
            </div>
            <div className="row">
              <div><label>Website / Project Name</label><input readOnly className="readonly" value={fmt(contract.project_name)} /></div>
            </div>
            <div className="row c2">
              <div><label>Service Start Date</label><input readOnly className="readonly" value={fmt(contract.start_date)} /></div>
              <div><label>Delivery Timeline</label><input readOnly className="readonly" value={fmt(contract.delivery_timeline)} /></div>
            </div>
            <div className="row c2">
              <div><label>Hosting Included</label><input readOnly className="readonly" value="1 Year" /></div>
              <div><label>SSL Included</label><input readOnly className="readonly" value="1 Year" /></div>
            </div>
            <div className="row c2">
              <div><label>Payment Type</label><input readOnly className="readonly" value={fmt(contract.payment_type)} /></div>
              <div><label>Total Amount (USD)</label><input readOnly className="readonly" value={contract.total_amount ? `$${Number(contract.total_amount).toFixed(2)}` : ''} /></div>
            </div>
          </div>

          {/* 3 Payment — client fills this */}
          <div className="sec">
            <div className="sec-title">3 · Payment Confirmation</div>
            <div className="row c2">
              <div>
                <label>Name on Card <span className="req">*</span></label>
                <input value={payment.name_on_card} onChange={setP('name_on_card')} placeholder="As printed on card" />
              </div>
              <div>
                <label>Card Type <span className="req">*</span></label>
                <div className="cbadges">
                  {CARD_TYPES.map(ct => (
                    <div
                      key={ct}
                      className={`cbadge${payment.card_type === ct ? ' on' : ''}`}
                      onClick={() => setPayment(p => ({ ...p, card_type: ct }))}
                    >
                      {ct.toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="row c2">
              <div>
                <label>Last 4 Digits <span className="req">*</span></label>
                <input
                  value={payment.card_last_4}
                  onChange={e => setPayment(p => ({ ...p, card_last_4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="••••"
                  maxLength={4}
                />
              </div>
              <div>
                <label>First Payment (USD) <span className="req">*</span></label>
                <input type="number" value={payment.first_payment} onChange={setP('first_payment')} placeholder="0.00" min="0" step="0.01" />
              </div>
            </div>
            <div className="row c2">
              <div>
                <label>Installment Payment (USD)</label>
                <input type="number" value={payment.installment_payment} onChange={setP('installment_payment')} placeholder="0.00" min="0" step="0.01" />
              </div>
              <div>
                <label>Balance Payment (USD)</label>
                <input type="number" value={payment.balance_payment} onChange={setP('balance_payment')} placeholder="0.00" min="0" step="0.01" />
              </div>
            </div>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '10px', fontStyle: 'italic' }}>
              🔒 Novelio Technologies LLC does not store complete card information.
            </p>
          </div>

          {/* Terms sections — static */}
          <div className="sec">
            <div className="sec-title">4 · Scope of Services</div>
            <div className="policy">The selected package may include: <ul><li>Website Design &amp; Development</li><li>Mobile Responsive Design</li><li>Basic SEO Setup</li><li>Contact Form Setup</li><li>SSL Installation and Hosting Setup</li><li>Google Business Profile Guidance</li><li>Minor Content / Layout Adjustments</li></ul></div>
          </div>
          <div className="sec">
            <div className="sec-title">5 · Refund Policy</div>
            <div className="policy">Client is eligible for a <strong>7-Day Refund Window</strong> from project delivery or activation. After 7 days, refunds are not available due to development efforts, hosting/server charges, and resources already incurred.</div>
          </div>
          <div className="sec">
            <div className="sec-title">6 · Hosting &amp; SSL Renewal</div>
            <div className="policy">Hosting and SSL are included for one (1) year from the Service Start Date. Renewal beyond the first year is chargeable separately and requires the Client's written approval. Failure to renew may impact website accessibility, email services, and security.</div>
          </div>
          <div className="sec">
            <div className="sec-title">7 · Minor Changes &amp; Additional Work</div>
            <div className="policy">Minor changes are included for 3 months post-launch. Work requiring 30+ minutes is billed at <strong>$40.00/hour</strong>. Major redesigns or new functionality require a separate agreement.</div>
          </div>
          <div className="sec">
            <div className="sec-title">8–11 · Additional Terms</div>
            <div className="policy">
              <strong>Content &amp; Images:</strong> All content, images, and materials must be provided by the Client. Novelio is not responsible for delays due to missing Client materials.<br /><br />
              <strong>Google Business Profile:</strong> GMB approval, ranking, and visibility are governed solely by Google. Novelio makes no guarantees regarding GMB outcomes.<br /><br />
              <strong>Support:</strong> Support is limited to services in the selected package. Third-party platform issues are not the responsibility of Novelio.<br /><br />
              <strong>Client Responsibilities:</strong> Client must promptly provide: business logo, website content, images/videos, contact details, social media links, and GMB documents where applicable.
            </div>
          </div>

          {/* 12 Acknowledgments */}
          <div className="sec">
            <div className="sec-title">12 · Client Acknowledgment</div>
            <div className="checks">
              {ACKS.map((txt, i) => (
                <div
                  key={i}
                  className={`chk${acks[i] ? ' on' : ''}`}
                  onClick={() => toggleAck(i)}
                >
                  <div className="chk-box" />
                  <span className="chk-txt">{txt}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Signatures */}
          <div className="sec">
            <div className="sec-title">Signatures</div>
            <div className="sig-grid">
              {/* Client signs */}
              <div>
                <div className="sig-head">Client Signature <span style={{ color: '#e53e3e' }}>*</span></div>
                <canvas
                  ref={canvasRef}
                  height={110}
                  className={hasSig ? 'signed' : ''}
                  onMouseDown={onDown} onMouseMove={onMove}
                  onMouseUp={() => setDrawing(false)} onMouseLeave={() => setDrawing(false)}
                  onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={() => setDrawing(false)}
                />
                {hasSig && (
                  <button type="button" className="clr" onClick={clearSig}>✕ Clear</button>
                )}
                <div style={{ marginTop: '12px' }} className="row">
                  <div>
                    <label>Full Legal Name <span className="req">*</span></label>
                    <input value={payment.client_full_name} onChange={setP('client_full_name')} placeholder="Full legal name" />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label>Date Signed</label>
                    <input type="date" value={payment.client_sign_date} onChange={setP('client_sign_date')} />
                  </div>
                </div>
              </div>

              {/* Rep signature — pre-applied */}
              <div>
                <div className="sig-head">Novelio Representative</div>
                {contract.rep_signature ? (
                  <img src={contract.rep_signature} alt="Representative Signature" className="rep-sig-img" />
                ) : (
                  <div style={{ height: '110px', border: '1.5px solid #e5e7eb', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px' }}>
                    Signature on file
                  </div>
                )}
                <div className="rep-sig-text">
                  <div style={{ marginTop: '12px' }}><strong>{fmt(contract.rep_name)}</strong></div>
                  <div style={{ color: '#6b7280' }}>{fmt(contract.rep_title)}</div>
                  <div style={{ color: '#6b7280' }}>{fmt(contract.rep_sign_date)}</div>
                  <div style={{ marginTop: '4px' }}>
                    <span className="signed-badge">✓ Signed by Novelio</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className={`msg err show`} style={{ margin: '0 32px 16px' }}>
              ⚠️ &nbsp;{error}
            </div>
          )}

          {/* Submit */}
          <div className="actions">
            <button
              className="btn btn-blue"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <><span className="spin" /> Submitting…</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: 'currentColor', fill: 'none', strokeWidth: 2.5 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Submit &amp; Sign Agreement
                </>
              )}
            </button>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>
              By clicking Submit, you agree to all terms above.
            </p>
          </div>

          <div className="foot">
            <strong>Novelio Technologies LLC</strong> · 8 The Green STE A, Dover, DE 19901 · +1-609-325-2541 · support@noveliotech.com
          </div>
        </div>
      </div>
    </>
  )
}
