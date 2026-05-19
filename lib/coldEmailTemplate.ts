export interface PageSpeedResult {
  url: string
  scores: {
    performance: number
    seo: number
    accessibility: number
    bestPractices: number
  }
  metrics: {
    lcp: string
    fcp: string
    cls: string
    tbt: string
    speedIndex: string
    tti: string
  }
  opportunities: Array<{ title: string; savings: string | null }>
}

function scoreColor(s: number) {
  if (s >= 90) return '#22c55e'
  if (s >= 50) return '#f97316'
  return '#ef4444'
}

function scoreLabel(s: number) {
  if (s >= 90) return 'Good'
  if (s >= 50) return 'Needs Work'
  return 'Poor'
}

function card(label: string, score: number) {
  return `
    <td style="text-align:center;padding:4px;">
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px 10px;min-width:110px;">
        <div style="font-size:28px;font-weight:700;color:${scoreColor(score)};">${score}</div>
        <div style="font-size:10px;color:${scoreColor(score)};font-weight:600;margin-top:2px;">${scoreLabel(score)}</div>
        <div style="font-size:10px;color:#64748b;margin-top:4px;">${label}</div>
      </div>
    </td>`
}

function metricRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:9px 14px;font-size:13px;color:#94a3b8;border-bottom:1px solid #1e293b;">${label}</td>
      <td style="padding:9px 14px;font-size:13px;color:#e2e8f0;font-weight:600;border-bottom:1px solid #1e293b;text-align:right;">${value}</td>
    </tr>`
}

export function generateColdEmailSubject(businessName: string, scores: PageSpeedResult['scores']) {
  const p = scores.performance
  if (p < 50) return `${businessName}'s website is critically slow — we can fix it`
  if (p < 90) return `${businessName}: your website speed is costing you customers`
  return `${businessName} — your website performance report`
}

export function generateColdEmailBody(
  data: PageSpeedResult,
  businessName: string,
  agencyName = 'Our Agency',
  demoUrl?: string,
) {
  const { scores, metrics, opportunities, url } = data
  const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const issueItems = opportunities
    .map(
      o =>
        `<li style="padding:7px 0;font-size:13px;color:#cbd5e1;border-bottom:1px solid #1e293b40;">` +
        `<span style="color:#f97316;font-weight:700;">›</span> ${o.title}` +
        (o.savings ? ` <span style="color:#64748b;font-size:11px;">(${o.savings})</span>` : '') +
        `</li>`,
    )
    .join('')

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#0A0820;color:#e2e8f0;max-width:620px;margin:0 auto;border-radius:12px;overflow:hidden;border:1px solid #1e293b;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 32px;border-bottom:1px solid #1e293b;">
    <p style="margin:0 0 6px;font-size:10px;color:#f97316;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Website Performance Report</p>
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#f8fafc;">${businessName}</h1>
    <p style="margin:0;font-size:12px;color:#64748b;">${displayUrl} &nbsp;·&nbsp; Mobile Analysis</p>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px;">

    <p style="font-size:15px;color:#cbd5e1;line-height:1.7;margin:0 0 8px;">Hi there,</p>
    <p style="font-size:15px;color:#cbd5e1;line-height:1.7;margin:0 0 20px;">
      We ran a full performance audit on <strong style="color:#f8fafc;">${displayUrl}</strong> and found several issues that are likely costing you leads and revenue. Here's what Google sees when it crawls your site:
    </p>

    <!-- Score Cards -->
    <table width="100%" cellpadding="0" cellspacing="4" style="margin:0 0 24px;">
      <tr>
        ${card('Performance', scores.performance)}
        ${card('SEO', scores.seo)}
        ${card('Accessibility', scores.accessibility)}
        ${card('Best Practices', scores.bestPractices)}
      </tr>
    </table>

    <!-- Core Web Vitals -->
    <p style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">Core Web Vitals</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tbody>
        ${metricRow('Largest Contentful Paint (LCP)', metrics.lcp)}
        ${metricRow('First Contentful Paint (FCP)', metrics.fcp)}
        ${metricRow('Cumulative Layout Shift (CLS)', metrics.cls)}
        ${metricRow('Total Blocking Time (TBT)', metrics.tbt)}
        ${metricRow('Speed Index', metrics.speedIndex)}
        ${metricRow('Time to Interactive (TTI)', metrics.tti)}
      </tbody>
    </table>

    ${
      opportunities.length > 0
        ? `<!-- Top Issues -->
    <p style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">Top Issues Found</p>
    <ul style="margin:0 0 24px;padding:8px 16px;list-style:none;background:#0f172a;border:1px solid #1e293b;border-radius:8px;">
      ${issueItems}
    </ul>`
        : ''
    }

    <!-- CTA -->
    <div style="background:#0f172a;border:1px solid #f97316;border-radius:10px;padding:22px 24px;">
      <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#f8fafc;">We can fix all of this for you.</p>
      <p style="margin:0 0 18px;font-size:13px;color:#94a3b8;line-height:1.7;">
        Our team specialises in turning slow, under-performing websites into high-converting lead machines. We'd love to walk you through exactly what's possible for ${businessName} — no obligation.
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="#" style="display:inline-block;background:#f97316;color:#ffffff;font-weight:700;font-size:13px;padding:11px 24px;border-radius:8px;text-decoration:none;">
          Book a Free Strategy Call →
        </a>
        ${demoUrl ? `<a href="${demoUrl}" style="display:inline-block;background:#1e293b;color:#f8fafc;font-weight:700;font-size:13px;padding:11px 24px;border-radius:8px;text-decoration:none;border:1px solid #334155;">
          View Your Demo Site →
        </a>` : ''}
      </div>
    </div>

  </div>

  <!-- Footer -->
  <div style="padding:16px 32px;border-top:1px solid #1e293b;text-align:center;">
    <p style="margin:0;font-size:11px;color:#475569;">${agencyName} &nbsp;·&nbsp; Data sourced from Google PageSpeed Insights</p>
  </div>

</div>`
}
