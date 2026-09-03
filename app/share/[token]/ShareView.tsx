'use client'

import { useState } from 'react'
import { prettyDate, usd, type ScheduleRow } from '@/lib/contract-plan'
import { SECTION_LABELS, type ShareSection } from '@/lib/share-link'
import { Card } from './Shell'

export interface ShareData {
  token: string
  business: string
  contactName: string | null
  sections: ShareSection[]
  supportEmail: string
  proposal: {
    package: string | null
    projectName: string | null
    startDate: string | null
    deliveryTimeline: string | null
    paymentType: string | null
    totalAmount: number | null
    scopeItems: string[]
    schedule: ScheduleRow[]
    signUrl: string | null
    alreadySigned: boolean
  } | null
  contract: {
    signed: boolean
    signedAt: string | null
    package: string | null
    totalAmount: number | null
    paymentType: string | null
    hasPdf: boolean
    signUrl: string | null
    awaitingExpired: boolean
  } | null
  audit: {
    score: number | null
    preparedAt: string | null
    hasShort: boolean
    hasLong: boolean
    hasSitemap: boolean
  } | null
}

const INK   = '#111827'
const MUTED = '#6b7280'
const NAVY  = '#1F3A93'
const LINE  = '#e5e7eb'

/** "2026-08-14T…" → "Aug 14, 2026", or '' when there's no usable date. */
function longDate(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleDateString('en-US', { dateStyle: 'medium' })
}

export function ShareView({ data }: { data: ShareData }) {
  const [tab, setTab] = useState<ShareSection>(data.sections[0])

  // Documents are fetched through the app, never from storage: the URL is
  // useless to anyone who hasn't passed the gate, and dies with the link.
  const fileUrl = (kind: string) => `/api/public/share/${data.token}/file?kind=${kind}`

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '18px' }}>
        <h1 style={{ fontSize: '21px', fontWeight: 700, color: NAVY, margin: '0 0 4px' }}>
          {data.business}
        </h1>
        <p style={{ fontSize: '13px', color: MUTED, margin: 0 }}>
          {data.contactName ? `Prepared for ${data.contactName}` : 'Your documents'} · Noveliotech
        </p>
      </div>

      {data.sections.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {data.sections.map(s => (
            <button
              key={s}
              onClick={() => setTab(s)}
              style={{
                flex: '1 1 110px',
                padding: '10px 12px',
                fontSize: '13px',
                fontWeight: 700,
                fontFamily: 'inherit',
                color: tab === s ? '#fff' : '#4b5563',
                background: tab === s ? NAVY : '#fff',
                border: `1px solid ${tab === s ? NAVY : LINE}`,
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              {SECTION_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      <Card>
        <div style={{ padding: '26px 24px 30px' }}>
          {tab === 'proposal' && <Proposal data={data} />}
          {tab === 'contract' && <Agreement data={data} fileUrl={fileUrl} />}
          {tab === 'audit'    && <Audit data={data} fileUrl={fileUrl} />}
        </div>
      </Card>

      <p style={{ textAlign: 'center', fontSize: '12px', color: MUTED, marginTop: '18px', lineHeight: 1.7 }}>
        Questions about anything here?{' '}
        <a href={`mailto:${data.supportEmail}`} style={{ color: NAVY, fontWeight: 600 }}>{data.supportEmail}</a>
        <br />
        This page is private to you — please don&apos;t forward the link.
      </p>
    </>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Proposal({ data }: { data: ShareData }) {
  const p = data.proposal
  if (!p) {
    return (
      <Empty
        icon="📝"
        title="Proposal on the way"
        body="We're still putting your proposal together. It will appear here as soon as it's ready."
      />
    )
  }

  return (
    <>
      <SectionTitle>Your Proposal</SectionTitle>

      <Facts rows={[
        ['Package',  p.package],
        ['Project',  p.projectName],
        ['Starts',   p.startDate ? prettyDate(p.startDate) : null],
        ['Timeline', p.deliveryTimeline],
      ]} />

      {p.scopeItems.length > 0 && (
        <>
          <SubTitle>What&apos;s included</SubTitle>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 22px' }}>
            {p.scopeItems.map((item, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  gap: '9px',
                  alignItems: 'flex-start',
                  padding: '7px 0',
                  fontSize: '14px',
                  color: '#374151',
                  borderBottom: i < p.scopeItems.length - 1 ? `1px solid ${LINE}` : 'none',
                }}
              >
                <span style={{ color: '#16a34a', fontWeight: 700, lineHeight: 1.4 }}>✓</span>
                <span style={{ lineHeight: 1.5 }}>{item}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {p.totalAmount != null && (
        <div style={{ background: '#f9fafb', border: `1px solid ${LINE}`, borderRadius: '12px', padding: '18px 20px', marginBottom: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: MUTED }}>Total investment</span>
            <span style={{ fontSize: '24px', fontWeight: 700, color: INK }}>{usd(p.totalAmount)}</span>
          </div>
          {p.paymentType && (
            <p style={{ fontSize: '13px', color: MUTED, margin: '4px 0 0' }}>{p.paymentType} payment plan</p>
          )}

          {p.schedule.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '14px', fontSize: '13px' }}>
              <tbody>
                {p.schedule.map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={{ padding: '8px 0', color: '#374151' }}>{row.label}</td>
                    <td style={{ padding: '8px 0', color: MUTED, textAlign: 'right', whiteSpace: 'nowrap' }}>{prettyDate(row.due_date)}</td>
                    <td style={{ padding: '8px 0 8px 14px', color: INK, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{usd(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {p.signUrl ? (
        <Action href={p.signUrl}>Review &amp; sign the agreement →</Action>
      ) : p.alreadySigned ? (
        <Banner tone="good">You&apos;ve already signed this agreement — thank you!</Banner>
      ) : (
        <Banner tone="muted">Happy with this? Reply to our last message and we&apos;ll send the agreement over.</Banner>
      )}
    </>
  )
}

function Agreement({ data, fileUrl }: { data: ShareData; fileUrl: (kind: string) => string }) {
  const c = data.contract
  if (!c) {
    return <Empty icon="📄" title="No agreement yet" body="Your service agreement will appear here once we send it." />
  }

  if (c.signed) {
    const on = longDate(c.signedAt)
    return (
      <>
        <SectionTitle>Service Agreement</SectionTitle>
        <Banner tone="good">
          Signed{on ? ` on ${on}` : ''}. Thank you for your business!
        </Banner>
        <Facts rows={[
          ['Package',      c.package],
          ['Total',        c.totalAmount != null ? usd(c.totalAmount) : null],
          ['Payment plan', c.paymentType],
        ]} />
        {c.hasPdf ? (
          <Action href={fileUrl('contract_pdf')} newTab>Open the signed agreement (PDF)</Action>
        ) : (
          <Banner tone="muted">
            A copy of the signed agreement was emailed to you. Need another? Email {data.supportEmail}.
          </Banner>
        )}
      </>
    )
  }

  if (c.signUrl) {
    return (
      <>
        <SectionTitle>Service Agreement</SectionTitle>
        <Banner tone="warn">Your agreement is ready and waiting for your signature.</Banner>
        <Facts rows={[
          ['Package',      c.package],
          ['Total',        c.totalAmount != null ? usd(c.totalAmount) : null],
          ['Payment plan', c.paymentType],
        ]} />
        <Action href={c.signUrl}>Review &amp; sign now →</Action>
      </>
    )
  }

  if (c.awaitingExpired) {
    return (
      <Empty
        icon="⏳"
        title="Signing window closed"
        body={`The agreement we sent has expired. Email ${data.supportEmail} and we'll send you a fresh one right away.`}
      />
    )
  }

  return <Empty icon="📄" title="No agreement yet" body="Your service agreement will appear here once we send it." />
}

function Audit({ data, fileUrl }: { data: ShareData; fileUrl: (kind: string) => string }) {
  const a = data.audit
  if (!a) {
    return (
      <Empty
        icon="📊"
        title="Report in progress"
        body="Your website report is being prepared and will show up here shortly."
      />
    )
  }

  const primary = a.hasShort ? 'audit_short' : a.hasLong ? 'audit_long' : null
  const prepared = longDate(a.preparedAt)

  return (
    <>
      <SectionTitle>Website &amp; SEO Report</SectionTitle>

      {a.score != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f9fafb', border: `1px solid ${LINE}`, borderRadius: '12px', padding: '18px 20px', marginBottom: '20px' }}>
          <div
            style={{
              width: '62px',
              height: '62px',
              flexShrink: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '21px',
              fontWeight: 700,
              color: '#fff',
              background: a.score >= 70 ? '#16a34a' : a.score >= 40 ? '#f59e0b' : '#dc2626',
            }}
          >
            {a.score}
          </div>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 700, color: INK, margin: '0 0 3px' }}>
              Your current online score
            </p>
            <p style={{ fontSize: '13px', color: MUTED, margin: 0, lineHeight: 1.5 }}>
              Out of 100{prepared ? ` · prepared ${prepared}` : ''}
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: '9px', marginBottom: primary ? '22px' : 0 }}>
        {a.hasShort   && <Action href={fileUrl('audit_short')} newTab tone="soft">📄 Summary report</Action>}
        {a.hasLong    && <Action href={fileUrl('audit_long')}  newTab tone="soft">📚 Full detailed report</Action>}
        {a.hasSitemap && <Action href={fileUrl('sitemap')}     newTab tone="soft">🗺️ Proposed site structure</Action>}
      </div>

      {primary && (
        // Inline preview for desktop; phones that can't render a PDF frame fall
        // back to the buttons above, which is why those come first.
        <object
          data={fileUrl(primary)}
          type="application/pdf"
          style={{ width: '100%', height: '520px', border: `1px solid ${LINE}`, borderRadius: '10px' }}
        >
          <p style={{ fontSize: '13px', color: MUTED, margin: 0 }}>
            Use the buttons above to open your report.
          </p>
        </object>
      )}
    </>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: '17px', fontWeight: 700, color: INK, margin: '0 0 16px' }}>{children}</h2>
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 8px' }}>
      {children}
    </p>
  )
}

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => !!v)
  if (shown.length === 0) return null
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '14px 20px', margin: '0 0 22px' }}>
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt style={{ fontSize: '12px', color: MUTED, marginBottom: '2px' }}>{label}</dt>
          <dd style={{ fontSize: '14px', fontWeight: 600, color: INK, margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Action({ href, children, newTab = false, tone = 'primary' }: {
  href: string
  children: React.ReactNode
  newTab?: boolean
  tone?: 'primary' | 'soft'
}) {
  const primary = tone === 'primary'
  return (
    <a
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noreferrer' } : {})}
      style={{
        display: 'block',
        textAlign: 'center',
        padding: '14px 18px',
        fontSize: '15px',
        fontWeight: 700,
        textDecoration: 'none',
        color: primary ? '#fff' : '#1f2937',
        background: primary ? NAVY : '#f3f4f6',
        border: `1px solid ${primary ? NAVY : LINE}`,
        borderRadius: '10px',
      }}
    >
      {children}
    </a>
  )
}

function Banner({ tone, children }: { tone: 'good' | 'warn' | 'muted'; children: React.ReactNode }) {
  const palette = {
    good:  { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' },
    warn:  { bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
    muted: { bg: '#f9fafb', border: LINE,      color: '#4b5563' },
  }[tone]
  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        borderRadius: '10px',
        padding: '13px 16px',
        fontSize: '13.5px',
        lineHeight: 1.55,
        marginBottom: '20px',
      }}
    >
      {children}
    </div>
  )
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '26px 6px' }}>
      <div style={{ fontSize: '38px', marginBottom: '10px' }}>{icon}</div>
      <p style={{ fontSize: '16px', fontWeight: 700, color: INK, margin: '0 0 6px' }}>{title}</p>
      <p style={{ fontSize: '13.5px', color: MUTED, margin: 0, lineHeight: 1.6 }}>{body}</p>
    </div>
  )
}
