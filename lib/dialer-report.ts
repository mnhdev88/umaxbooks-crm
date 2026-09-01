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
  // Derived (computed after aggregation) so the dashboard and CSV/email share them.
  connect_rate: number    // connected / calls, 0–100 (%)
  avg_talk_sec: number    // talk_sec / connected (avg seconds per connected call)
  conversion_rate: number // appointments / calls, 0–100 (%)
}

/**
 * The same call volume sliced by the caller ID it went out on rather than by agent.
 *
 * WHY: connect rate per agent measures the agent; connect rate per number measures the
 * number's carrier reputation. A number that has been labelled "Spam Likely" shows up
 * here as a collapsing connect rate while every agent's own figures look normal, which
 * is the signal that decides whether to rest it (see caller_numbers.is_active) or take
 * it out of the rotation (auto_rotate, migration 108).
 */
export interface NumberSummary {
  from_number: string
  /** caller_numbers.label, or null once a number has been deleted from the pool. */
  label: string | null
  calls: number
  connected: number
  voicemail: number
  no_answer: number
  appointments: number
  talk_sec: number
  connect_rate: number   // connected / calls, 0–100 (%)
  avg_talk_sec: number
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
  /** The caller ID it was placed from — labelled where the number is still in the pool. */
  from_number: string
}

export interface DialerReport {
  fromISO: string | null
  toISO: string | null
  label: string
  summary: AgentSummary[]
  /** Per caller ID, busiest first. Excludes rows with no from_number (pre-Aug 2026). */
  by_number: NumberSummary[]
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
 * caller — even those with zero calls — so the daily report doubles as an
 * activity roll-call.
 *
 * Pass `agentIds` to scope the report to a specific set of callers (e.g. a
 * sales manager's team). When omitted, every sales agent AND sales manager is
 * included — they all place dialer calls and should be measured.
 */
export async function buildDialerReport(
  service: SupabaseClient,
  opts: { fromISO: string | null; toISO: string | null; label: string; agentIds?: string[] | null },
): Promise<DialerReport> {
  const { fromISO, toISO, label, agentIds } = opts
  const scoped = Array.isArray(agentIds)

  // The callers to seed (for names + zero-call rows). When scoped, fetch those
  // exact profiles; otherwise every sales agent + manager.
  let agentQuery = service.from('profiles').select('id, full_name').order('full_name')
  agentQuery = scoped
    ? agentQuery.in('id', agentIds!.length ? agentIds! : ['00000000-0000-0000-0000-000000000000'])
    : agentQuery.in('role', ['agent', 'sales_agent', 'sales_manager'])
  const { data: agents } = await agentQuery

  const agentName = new Map<string, string>()
  for (const a of agents ?? []) agentName.set(a.id, a.full_name || '(unnamed)')

  // The report covers ONLY these callers. When scoped, that's the requested set;
  // otherwise it's every sales agent + manager. Either way, calls placed by
  // anyone else (admins, deleted users) and calls with no agent recorded are
  // excluded — so there's never an "Unknown agent" bucket.
  const allowedIds = scoped ? (agentIds as string[]) : [...agentName.keys()]
  // Postgres needs a non-empty list; a sentinel UUID matches nothing.
  const idFilter = allowedIds.length ? allowedIds : ['00000000-0000-0000-0000-000000000000']

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
    from_number: string | null
    leads: { name: string | null; company_name: string | null } | null
  }
  const rows: Row[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    let q = service
      .from('voice_calls')
      .select('created_at, agent_user_id, direction, status, duration_sec, answered_by, interested, appointment_booked, do_not_call, from_number, leads(name, company_name)')
      .eq('provider', 'twilio')
      // Outbound only. Inbound callbacks (092) also carry an agent_user_id, and
      // counting them here would credit agents against their daily call target for
      // calls they received rather than made. Every pre-092 row is outbound, so
      // this changes no historical figure.
      .eq('direction', 'outbound')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (fromISO) q = q.gte('created_at', fromISO)
    if (toISO) q = q.lt('created_at', toISO)
    // Restrict to the allowed callers (sales agents + managers, or a scoped
    // team). The id set is small, so .in() stays well under the URL-length limit.
    q = q.in('agent_user_id', idFilter)
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
      connect_rate: 0, avg_talk_sec: 0, conversion_rate: 0,
    })
  }

  // Labels for our own numbers, so the per-number block reads like the dialer dropdown.
  // Every row is fetched, not just active ones: a report over a past range covers calls
  // placed on numbers that have since been rested or retired.
  const numberLabel = new Map<string, string | null>()
  {
    const { data: pool } = await service.from('caller_numbers').select('phone_number, label')
    for (const n of (pool ?? []) as { phone_number: string; label: string | null }[]) {
      numberLabel.set(n.phone_number, n.label)
    }
  }

  const byNumber = new Map<string, NumberSummary>()
  const detail: CallDetail[] = []

  for (const r of rows) {
    const id = r.agent_user_id
    // The query already restricts to allowed callers, so every row maps to a
    // seeded summary. Skip defensively if not (shouldn't happen).
    const s = id ? summaries.get(id) : undefined
    if (!s) continue
    const name = s.agent_name
    s.calls++
    if (r.status === 'completed') s.connected++
    if (r.answered_by === 'voicemail') s.voicemail++
    if (r.status && NO_ANSWER_STATUSES.has(r.status)) s.no_answer++
    if (r.interested === 'yes') s.interested++
    if (r.appointment_booked) s.appointments++
    s.talk_sec += r.duration_sec ?? 0

    // Calls placed before the pool recorded a from_number (everything up to Jul 2026)
    // are skipped here rather than bucketed as "unknown": a phantom row carrying a
    // quarter of all historical calls would dominate the table and mean nothing.
    if (r.from_number) {
      let ns = byNumber.get(r.from_number)
      if (!ns) {
        ns = {
          from_number: r.from_number,
          label: numberLabel.get(r.from_number) ?? null,
          calls: 0, connected: 0, voicemail: 0, no_answer: 0, appointments: 0,
          talk_sec: 0, connect_rate: 0, avg_talk_sec: 0,
        }
        byNumber.set(r.from_number, ns)
      }
      ns.calls++
      if (r.status === 'completed') ns.connected++
      if (r.answered_by === 'voicemail') ns.voicemail++
      if (r.status && NO_ANSWER_STATUSES.has(r.status)) ns.no_answer++
      if (r.appointment_booked) ns.appointments++
      ns.talk_sec += r.duration_sec ?? 0
    }

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
      from_number: r.from_number
        ? (numberLabel.get(r.from_number) ? `${numberLabel.get(r.from_number)} (${r.from_number})` : r.from_number)
        : '',
    })
  }

  // Derive rate metrics now that the raw counts are final.
  for (const s of summaries.values()) {
    s.connect_rate = s.calls ? Math.round((s.connected / s.calls) * 100) : 0
    s.avg_talk_sec = s.connected ? Math.round(s.talk_sec / s.connected) : 0
    s.conversion_rate = s.calls ? Math.round((s.appointments / s.calls) * 100) : 0
  }

  for (const n of byNumber.values()) {
    n.connect_rate = n.calls ? Math.round((n.connected / n.calls) * 100) : 0
    n.avg_talk_sec = n.connected ? Math.round(n.talk_sec / n.connected) : 0
  }

  const summary = [...summaries.values()].sort((a, b) => b.calls - a.calls || a.agent_name.localeCompare(b.agent_name))
  const by_number = [...byNumber.values()].sort((a, b) => b.calls - a.calls || a.from_number.localeCompare(b.from_number))

  return { fromISO, toISO, label, summary, by_number, detail }
}

// ── CSV serialisation ────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',')
}

/** Three blocks: per-agent summary, per-caller-ID summary, then per-call detail. */
export function dialerReportToCSV(report: DialerReport): string {
  const lines: string[] = []

  lines.push(`Dialer Calls Report,${csvCell(report.label)}`)
  lines.push('')

  lines.push('PER-AGENT SUMMARY')
  lines.push(csvRow(['Agent', 'Calls', 'Connected', 'Connect %', 'Voicemail', 'No answer', 'Interested', 'Appointments', 'Conversion %', 'Talk time', 'Avg talk/call']))
  for (const s of report.summary) {
    lines.push(csvRow([s.agent_name, s.calls, s.connected, `${s.connect_rate}%`, s.voicemail, s.no_answer, s.interested, s.appointments, `${s.conversion_rate}%`, fmtDuration(s.talk_sec), fmtDuration(s.avg_talk_sec)]))
  }
  lines.push('')

  // Only when there is something to show: a range made up entirely of pre-Aug-2026
  // calls has no from_number on any row, and an empty headed block reads like a bug.
  if (report.by_number.length > 0) {
    lines.push('PER-NUMBER SUMMARY')
    lines.push(csvRow(['Called from', 'Number', 'Calls', 'Connected', 'Connect %', 'Voicemail', 'No answer', 'Appointments', 'Talk time', 'Avg talk/call']))
    for (const n of report.by_number) {
      lines.push(csvRow([n.label ?? '—', n.from_number, n.calls, n.connected, `${n.connect_rate}%`, n.voicemail, n.no_answer, n.appointments, fmtDuration(n.talk_sec), fmtDuration(n.avg_talk_sec)]))
    }
    lines.push('')
  }

  lines.push('CALL DETAIL')
  lines.push(csvRow(['Time', 'Agent', 'Lead', 'Called from', 'Direction', 'Status', 'Duration', 'Answered by', 'Interested', 'Appointment', 'Do not call']))
  for (const d of report.detail) {
    lines.push(csvRow([d.created_at, d.agent_name, d.lead, d.from_number, d.direction, d.status, fmtDuration(d.duration_sec), d.answered_by, d.interested, d.appointment, d.do_not_call]))
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
      <td ${tdNum}>${s.connect_rate}%</td>
      <td ${tdNum}>${s.voicemail}</td>
      <td ${tdNum}>${s.no_answer}</td>
      <td ${tdNum}>${s.appointments}</td>
      <td ${tdNum}>${s.conversion_rate}%</td>
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
          <th ${th} style="text-align:right">Connect %</th>
          <th ${th} style="text-align:right">Voicemail</th>
          <th ${th} style="text-align:right">No answer</th>
          <th ${th} style="text-align:right">Appts</th>
          <th ${th} style="text-align:right">Conv %</th>
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
