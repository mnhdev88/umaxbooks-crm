// Shared builder for the per-sales-agent dialer-call report.
//
// One source of truth so the on-demand download (/api/reports/dialer) and the
// nightly email cron (/api/cron/eod-dialer-report) produce identical output.
//
// "Dialer calls" = the human Twilio softphone dialer rows in `voice_calls`
// (provider = 'twilio', agent_user_id set). Bland AI calls (agent_user_id NULL)
// are excluded.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface AgentSummary {
  agent_id: string | null
  agent_name: string
  calls: number
  connected: number   // status = 'completed'
  voicemail: number   // answered_by = 'voicemail'
  no_answer: number   // status in busy/no-answer/failed/canceled
  interested: number  // interested = 'yes'
  appointments: number
  talk_sec: number    // Σ duration_sec
}

export interface CallDetail {
  created_at: string
  agent_name: string
  lead: string
  direction: string
  status: string
  duration_sec: number
  answered_by: string
  interested: string
  appointment: string
  do_not_call: string
}

export interface DialerReport {
  fromISO: string | null
  toISO: string | null
  label: string
  summary: AgentSummary[]
  detail: CallDetail[]
}

const NO_ANSWER_STATUSES = new Set(['busy', 'no-answer', 'failed', 'canceled'])

// Format seconds as H:MM:SS (or M:SS under an hour).
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

/**
 * Build the report for the half-open [fromISO, toISO) range. Includes every
 * sales agent — even those with zero calls — so the daily report doubles as an
 * activity roll-call.
 */
export async function buildDialerReport(
  service: SupabaseClient,
  opts: { fromISO: string | null; toISO: string | null; label: string },
): Promise<DialerReport> {
  const { fromISO, toISO, label } = opts

  // All sales agents (for names + zero-call rows).
  const { data: agents } = await service
    .from('profiles')
    .select('id, full_name')
    .in('role', ['agent', 'sales_agent'])
    .order('full_name')

  const agentName = new Map<string, string>()
  for (const a of agents ?? []) agentName.set(a.id, a.full_name || '(unnamed)')

  // Pull twilio (human dialer) calls in range, batched past the PostgREST
  // 1000-row cap — a busy day can exceed it and a single select would silently
  // truncate. Embed the lead for the detail rows (lead_id FK exists).
  type Row = {
    created_at: string
    agent_user_id: string | null
    direction: string | null
    status: string | null
    duration_sec: number | null
    answered_by: string | null
    interested: string | null
    appointment_booked: boolean | null
    do_not_call: boolean | null
    leads: { name: string | null; company_name: string | null } | null
  }
  const rows: Row[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    let q = service
      .from('voice_calls')
      .select('created_at, agent_user_id, direction, status, duration_sec, answered_by, interested, appointment_booked, do_not_call, leads(name, company_name)')
      .eq('provider', 'twilio')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (fromISO) q = q.gte('created_at', fromISO)
    if (toISO) q = q.lt('created_at', toISO)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  // Per-agent aggregates, seeded with every sales agent at zero.
  const summaries = new Map<string, AgentSummary>()
  for (const [id, name] of agentName) {
    summaries.set(id, {
      agent_id: id, agent_name: name,
      calls: 0, connected: 0, voicemail: 0, no_answer: 0,
      interested: 0, appointments: 0, talk_sec: 0,
    })
  }

  const detail: CallDetail[] = []

  for (const r of rows) {
    const id = r.agent_user_id
    const name = (id && agentName.get(id)) || 'Unknown agent'
    // Tolerate calls whose agent isn't in the sales-agent list (e.g. role
    // changed) by creating a bucket on the fly.
    const key = id ?? '__unknown__'
    let s = summaries.get(key)
    if (!s) {
      s = { agent_id: id, agent_name: name, calls: 0, connected: 0, voicemail: 0, no_answer: 0, interested: 0, appointments: 0, talk_sec: 0 }
      summaries.set(key, s)
    }
    s.calls++
    if (r.status === 'completed') s.connected++
    if (r.answered_by === 'voicemail') s.voicemail++
    if (r.status && NO_ANSWER_STATUSES.has(r.status)) s.no_answer++
    if (r.interested === 'yes') s.interested++
    if (r.appointment_booked) s.appointments++
    s.talk_sec += r.duration_sec ?? 0

    const leadLabel = r.leads?.name || r.leads?.company_name || '—'
    detail.push({
      created_at: r.created_at,
      agent_name: name,
      lead: leadLabel,
      direction: r.direction ?? '',
      status: r.status ?? '',
      duration_sec: r.duration_sec ?? 0,
      answered_by: r.answered_by ?? '',
      interested: r.interested ?? '',
      appointment: r.appointment_booked ? 'yes' : '',
      do_not_call: r.do_not_call ? 'yes' : '',
    })
  }

  const summary = [...summaries.values()].sort((a, b) => b.calls - a.calls || a.agent_name.localeCompare(b.agent_name))

  return { fromISO, toISO, label, summary, detail }
}

// ── CSV serialisation ────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',')
}

/** Two blocks: per-agent summary, then per-call detail. */
export function dialerReportToCSV(report: DialerReport): string {
  const lines: string[] = []

  lines.push(`Dialer Calls Report,${csvCell(report.label)}`)
  lines.push('')

  lines.push('PER-AGENT SUMMARY')
  lines.push(csvRow(['Agent', 'Calls', 'Connected', 'Voicemail', 'No answer', 'Interested', 'Appointments', 'Talk time']))
  for (const s of report.summary) {
    lines.push(csvRow([s.agent_name, s.calls, s.connected, s.voicemail, s.no_answer, s.interested, s.appointments, fmtDuration(s.talk_sec)]))
  }
  lines.push('')

  lines.push('CALL DETAIL')
  lines.push(csvRow(['Time', 'Agent', 'Lead', 'Direction', 'Status', 'Duration', 'Answered by', 'Interested', 'Appointment', 'Do not call']))
  for (const d of report.detail) {
    lines.push(csvRow([d.created_at, d.agent_name, d.lead, d.direction, d.status, fmtDuration(d.duration_sec), d.answered_by, d.interested, d.appointment, d.do_not_call]))
  }

  return lines.join('\r\n')
}

/** Compact HTML summary table for the daily email body. */
export function dialerSummaryHtml(report: DialerReport): string {
  const totalCalls = report.summary.reduce((n, s) => n + s.calls, 0)
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#475569"'
  const td = 'style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a"'
  const tdNum = 'style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums"'

  const rows = report.summary.map(s => `
    <tr>
      <td ${td}>${escapeHtml(s.agent_name)}</td>
      <td ${tdNum}>${s.calls}</td>
      <td ${tdNum}>${s.connected}</td>
      <td ${tdNum}>${s.voicemail}</td>
      <td ${tdNum}>${s.no_answer}</td>
      <td ${tdNum}>${s.interested}</td>
      <td ${tdNum}>${s.appointments}</td>
      <td ${tdNum}>${fmtDuration(s.talk_sec)}</td>
    </tr>`).join('')

  return `
  <div style="font-family:Arial,Helvetica,sans-serif">
    <h2 style="color:#0f172a;font-size:18px;margin:0 0 4px">Dialer Calls — Daily Report</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 16px">${escapeHtml(report.label)} · ${totalCalls} call${totalCalls === 1 ? '' : 's'} total</p>
    <table style="border-collapse:collapse;width:100%;max-width:680px">
      <thead>
        <tr>
          <th ${th}>Agent</th>
          <th ${th} style="text-align:right">Calls</th>
          <th ${th} style="text-align:right">Connected</th>
          <th ${th} style="text-align:right">Voicemail</th>
          <th ${th} style="text-align:right">No answer</th>
          <th ${th} style="text-align:right">Interested</th>
          <th ${th} style="text-align:right">Appts</th>
          <th ${th} style="text-align:right">Talk time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px">Full per-call detail is attached as a CSV.</p>
  </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
