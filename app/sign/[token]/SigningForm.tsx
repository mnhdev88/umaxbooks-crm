'use client'

import { useRef, useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Build a self-contained, inline-styled div for PDF capture.
// Using the live React form DOM is unreliable (canvas, React state, CSS classes).
// ---------------------------------------------------------------------------
function buildContractPdfHtml(
  contract: any,
  payment: {
    name_on_card: string; card_type: string; card_last_4: string
    first_payment: string; installment_payment: string; balance_payment: string
    client_full_name: string; client_sign_date: string
  },
  signatureDataUrl: string,
  geoInfo: { ip: string; city: string; region: string; country: string; isp: string },
  clientMeta: { timezone: string; screen: string; language: string; signed_at_utc: string },
  acks: readonly string[],
): string {
  const f = (v: any) => String(v ?? '—')
  const location = [geoInfo.city, geoInfo.region, geoInfo.country].filter(Boolean).join(', ') || 'Recorded'

  const sec = (title: string, body: string) => `
    <div style="padding:18px 32px;border-bottom:1px solid #f0f0f0;">
      <div style="font-size:11px;font-weight:700;color:#1F3A93;text-transform:uppercase;letter-spacing:.6px;
                  margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #eef1fb;">${title}</div>
      ${body}
    </div>`

  const kv = (label: string, val: string) => val && val !== '—' ? `
    <tr>
      <td style="padding:4px 12px 4px 0;font-size:12px;color:#6b7280;width:180px;vertical-align:top;">${label}</td>
      <td style="padding:4px 0;font-size:13px;color:#111;vertical-align:top;">${val}</td>
    </tr>` : ''

  const table = (...rows: string[]) =>
    `<table style="width:100%;border-collapse:collapse;">${rows.join('')}</table>`

  return `
<div style="max-width:800px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;color:#111;font-size:14px;">
  <div style="height:5px;background:linear-gradient(90deg,#1F3A93,#4a6cf7,#b8902a);"></div>

  <div style="text-align:center;padding:28px 32px 18px;border-bottom:1px solid #eee;">
    <h1 style="font-size:20px;font-weight:700;color:#1F3A93;margin:0 0 6px;">Website &amp; Digital Services Agreement</h1>
    <p style="font-size:12px;color:#6b7280;margin:0 0 6px;">Novelio Technologies LLC &nbsp;·&nbsp; 8 The Green STE A, Dover, DE 19901 &nbsp;·&nbsp; support@noveliotech.com</p>
    <p style="font-size:12px;color:#374151;font-style:italic;margin:0;">
      This agreement is entered into by and between Novelio Technologies LLC and the undersigned client.
    </p>
  </div>

  ${sec('1 · Client Information', table(
    kv('Business Name',   f(contract.business_name)),
    kv('Contact Person',  f(contract.contact_person)),
    kv('Address',         f(contract.address)),
    kv('City / State / ZIP', [contract.city, contract.state, contract.zip_code].filter(Boolean).join(', ')),
    kv('Phone',           f(contract.phone)),
    kv('Email',           f(contract.client_email)),
  ))}

  ${sec('2 · Service Details', table(
    kv('Package',          f(contract.package)),
    kv('Project Name',     f(contract.project_name)),
    kv('Start Date',       f(contract.start_date)),
    kv('Delivery Timeline',f(contract.delivery_timeline)),
    kv('Hosting Included', '1 Year'),
    kv('SSL Included',     '1 Year'),
    kv('Payment Type',     f(contract.payment_type)),
    kv('Total Amount',     contract.total_amount ? `$${Number(contract.total_amount).toFixed(2)}` : ''),
  ))}

  ${sec('3 · Payment Confirmation', table(
    kv('Name on Card',       payment.name_on_card),
    kv('Card Type',          payment.card_type),
    kv('Last 4 Digits',      payment.card_last_4),
    kv('First Payment',      payment.first_payment      ? `$${payment.first_payment}`      : ''),
    kv('Installment Payment',payment.installment_payment? `$${payment.installment_payment}`: ''),
    kv('Balance Payment',    payment.balance_payment    ? `$${payment.balance_payment}`    : ''),
  ))}

  ${sec('4 · Scope of Services',
    `<p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">
      The selected package may include: Website Design &amp; Development, Mobile Responsive Design, Basic SEO Setup, Contact Form Setup, SSL Installation and Hosting Setup, Google Business Profile Guidance, Minor Content / Layout Adjustments.
    </p>`)}

  ${sec('5 · Refund Policy',
    `<p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">
      Client is eligible for a <strong>7-Day Refund Window</strong> from project delivery or activation. After 7 days, refunds are not available due to development efforts, hosting/server charges, and resources already incurred.
    </p>`)}

  ${sec('6 · Hosting &amp; SSL Renewal',
    `<p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">
      Hosting and SSL are included for one (1) year from the Service Start Date. Renewal beyond the first year is chargeable separately and requires the Client's written approval.
    </p>`)}

  ${sec('7 · Minor Changes &amp; Additional Work',
    `<p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">
      Minor changes included for 3 months post-launch. Work requiring 30+ minutes is billed at <strong>$40.00/hour</strong>. Major redesigns require a separate agreement.
    </p>`)}

  ${sec('8–11 · Additional Terms',
    `<p style="font-size:12px;color:#374151;line-height:1.7;margin:0;">
      <strong>Content &amp; Images:</strong> All content and materials must be provided by the Client.<br>
      <strong>Google Business Profile:</strong> GMB approval and ranking are governed solely by Google. No guarantees are made.<br>
      <strong>Support:</strong> Support is limited to services in the selected package.<br>
      <strong>Client Responsibilities:</strong> Client must provide: business logo, website content, images/videos, contact details, social links.
    </p>`)}

  ${sec('12 · Client Acknowledgment',
    acks.map(txt => `
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;">
        <div style="width:14px;height:14px;flex-shrink:0;background:#1F3A93;border-radius:3px;margin-top:1px;
                    display:flex;align-items:center;justify-content:center;">
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <polyline points="1,3.5 3.5,6 8,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span style="font-size:12px;color:#374151;line-height:1.5;">${txt}</span>
      </div>`).join('')
  )}

  <div style="padding:20px 32px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;font-weight:700;color:#1F3A93;text-transform:uppercase;letter-spacing:.6px;
                margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #eef1fb;">Signatures</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <p style="font-size:12px;font-weight:600;color:#374151;margin:0 0 8px;">Client Signature</p>
        <img src="${signatureDataUrl}" style="width:100%;height:80px;border:1.5px solid #1F3A93;border-radius:6px;object-fit:contain;background:#fff;display:block;" />
        ${table(
          kv('Full Name', payment.client_full_name),
          kv('Date Signed', payment.client_sign_date),
        )}
      </div>
      <div>
        <p style="font-size:12px;font-weight:600;color:#374151;margin:0 0 8px;">Novelio Representative</p>
        ${contract.rep_signature
          ? `<img src="${contract.rep_signature}" style="width:100%;height:80px;border:1.5px solid #1F3A93;border-radius:6px;object-fit:contain;background:#fff;display:block;" />`
          : `<div style="width:100%;height:80px;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;">Signature on file</div>`}
        ${table(
          kv('Name',  f(contract.rep_name)),
          kv('Title', f(contract.rep_title)),
          kv('Date',  f(contract.rep_sign_date)),
        )}
        <div style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;background:#d1fae5;
                    color:#065f46;border:1px solid #6ee7b7;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;">
          ✓ Signed by Novelio
        </div>
      </div>
    </div>
  </div>

  <div style="padding:20px 32px;background:#f8f9fd;">
    <div style="font-size:11px;font-weight:700;color:#1F3A93;text-transform:uppercase;letter-spacing:.6px;
                margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #dde3f5;">
      Electronic Signature Certificate
    </div>
    ${table(
      kv('Document',       `Website &amp; Digital Services Agreement – ${contract.business_name}`),
      kv('Signed by',      `${payment.client_full_name} &lt;${contract.client_email}&gt;`),
      kv('Signed At (UTC)',clientMeta.signed_at_utc),
      kv('IP Address',     geoInfo.ip),
      kv('Location',       location),
      geoInfo.isp ? kv('ISP / Network', geoInfo.isp) : '',
      kv('Timezone',       clientMeta.timezone),
      kv('Language',       clientMeta.language),
      kv('Screen',         clientMeta.screen),
    )}
    <p style="font-size:10px;color:#9ca3af;margin-top:10px;line-height:1.6;">
      This certificate records technical details of the signing event for audit and legal compliance purposes. IP geolocation by ipinfo.io.
    </p>
  </div>

  <div style="text-align:center;font-size:11px;color:#9ca3af;padding:14px 32px;">
    Novelio Technologies LLC · 8 The Green STE A, Dover, DE 19901 · +1-609-325-2541 · support@noveliotech.com
  </div>
</div>`

}

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

function parseBrowserUA(ua: string): string {
  if (!ua) return 'Unknown'
  let browser = 'Unknown'
  let os = 'Unknown OS'
  if (ua.includes('Edg/') || ua.includes('Edge/')) browser = 'Edge'
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'
  if (ua.includes('Windows NT 10.0') || ua.includes('Windows NT 11.0')) os = 'Windows 10/11'
  else if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('iPhone')) os = 'iPhone (iOS)'
  else if (ua.includes('iPad')) os = 'iPad (iOS)'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('Mac OS X')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  return `${browser} on ${os}`
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

  const canvasRef = useRef<HTMLCanvasElement>(null)

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
      // Collect client-side metadata
      const signed_at_utc = new Date().toISOString()
      const clientMeta = {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen:   `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        browser:  navigator.userAgent,
        signed_at_utc,
      }

      // Fetch IP + geo from server (so it appears in the PDF certificate)
      let geoData = { ip: 'Recorded', city: '', region: '', country: '', isp: '', timezone: clientMeta.timezone }
      try {
        const geoRes = await fetch(`/api/contracts/${token}/sign`)
        if (geoRes.ok) geoData = await geoRes.json()
      } catch { /* best-effort */ }


      // Generate PDF using html2pdf. html2pdf wraps the source HTML in a container
      // with visibility:hidden — we use onclone to make it visible before html2canvas
      // renders, otherwise the canvas (and PDF) comes out blank.
      let pdf_base64: string | null = null
      if (window.html2pdf) {
        try {
          const htmlStr = buildContractPdfHtml(
            contract, payment, client_signature, geoData, clientMeta, ACKS,
          )
          const blob: Blob = await window.html2pdf().set({
            margin:      [8, 8, 8, 8],
            filename:    `Novelio-Agreement-${contract.business_name}.pdf`,
            image:       { type: 'jpeg', quality: 0.95 },
            html2canvas: {
              scale:     1.5,
              useCORS:   true,
              logging:   false,
              // html2pdf puts content in visibility:hidden; fix before capture
              onclone: (clonedDoc: Document) => {
                clonedDoc.querySelectorAll<HTMLElement>('[style*="visibility"]').forEach(el => {
                  el.style.visibility = 'visible'
                })
              },
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          }).from(htmlStr).toPdf().outputPdf('blob')

          pdf_base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload  = () => resolve((reader.result as string).split(',')[1])
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
        } catch (pdfErr) {
          console.error('PDF generation error:', pdfErr)
          // Non-fatal — contract will be saved without an attached PDF
        }
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
          client_meta: clientMeta,
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
        <div className="box" id="nva-card">
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
