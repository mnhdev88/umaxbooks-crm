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
  // The four outcome buckets are exclusive and sum to `calls` — see classifyCall.
  connected: number   // line answered AND the agent filed a wrap-up: a human was reached
  voicemail: number   // agent marked voicemail
  no_answer: number   // never bridged, or the agent marked an instant hangup
  unknown: number     // answered but never dispositioned (a skipped wrap-up)
  interested: number  // interested = 'yes'
  appointments: number
  talk_sec: number    // Σ duration_sec over ALL calls — total time on the line
  /** Σ duration_sec over connected calls only. Backs avg_talk_sec; not displayed. */
  connected_talk_sec: number
  // Derived (computed after aggregation) so the dashboard and CSV/email share them.
  connect_rate: number    // connected / calls, 0–100 (%)
  avg_talk_sec: number    // connected_talk_sec / connected — seconds per conversation
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
  unknown: number
  appointments: number
  talk_sec: number
  connected_talk_sec: number
  connect_rate: number   // connected / calls, 0–100 (%)
  avg_talk_sec: number
}

/**
 * Inbound callbacks, counted per agent who ANSWERED them.
 *
 * WHY answered-only: on an answered row `agent_user_id` is whoever picked up, but on an
 * abandoned one it is the owner whose phone rang and who did not — and a third of
 * abandoned calls have no agent recorded at all (an unknown number outside anyone's
 * history). Mixing the two would read as "calls handled" while quietly counting misses,
 * so missed calls live in the totals and the per-line table only, never against a name.
 */
export interface InboundAgentSummary {
  agent_id: string | null
  agent_name: string
  answered: number       // answered-owner + answered-hunt, by the agent who took it
  answered_owner: number // they were the one the caller had spoken to before
  answered_hunt: number  // they picked it out of the hunt group
  talk_sec: number       // Σ recording length over their answered calls
  avg_talk_sec: number   // talk_sec / answered
}

/**
 * The same callbacks sliced by which of our pool numbers the lead rang back on.
 *
 * WHY: a line with a healthy outbound connect rate but no callbacks at all is being
 * screened; one with a high abandoned share is ringing out while nobody is at a desk.
 * Neither shows up in the per-agent view.
 */
export interface InboundLineSummary {
  to_number: string
  label: string | null
  received: number
  answered: number
  voicemail: number
  abandoned: number
  after_hours: number
  answer_rate: number // answered / received, 0–100 (%)
  talk_sec: number
}

export interface InboundSummary {
  received: number
  answered: number
  answered_owner: number
  answered_hunt: number
  voicemail: number
  abandoned: number
  /** Subset of the above that arrived outside business hours (the '-closed' outcomes). */
  after_hours: number
  answer_rate: number // answered / received, 0–100 (%)
  talk_sec: number
  avg_talk_sec: number
  by_agent: InboundAgentSummary[]
  by_line: InboundLineSummary[]
}

export interface InboundDetail {
  created_at: string
  lead: string
  from_number: string  // the lead's number
  line: string         // the pool number they rang, labelled
  outcome: string      // inbound_outcome, verbatim
  handled_by: string   // the agent who answered, blank when nobody did
  duration_sec: number
}

export interface CallDetail {
  created_at: string
  agent_name: string
  lead: string
  direction: string
  status: string
  /** The classified outcome — what the summary counted this call as. */
  outcome: CallOutcome
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
  /** Callbacks received in the same range. Counted from inbound_outcome — see buildInbound. */
  inbound: InboundSummary
  inbound_detail: InboundDetail[]
}

const NO_ANSWER_STATUSES = new Set(['busy', 'no-answer', 'failed', 'canceled'])

export type CallOutcome = 'connected' | 'voicemail' | 'no_answer' | 'unknown'

/**
 * The one place a call becomes a number. Every call resolves to exactly one outcome,
 * so the buckets sum to the call count instead of overlapping.
 *
 * WHY THIS EXISTS: "connected" used to be Twilio's status = 'completed', which only means
 * the line was picked up by *something*. A voicemail box picks up the line, so voicemails
 * counted as connected — and since voicemail was tallied in its own separate branch, an
 * agent-marked voicemail was counted twice over. A third of the old connect number was
 * voicemail.
 *
 * The agent's wrap-up outranks Twilio's status, because Twilio cannot tell a conversation
 * from a lead who answered and hung up on the first syllable — both are 'completed'.
 *
 * Mirrored in SQL by voice_call_outcome() (migration 109), which backs the per-number
 * health table. Change one, change the other.
 */
export function classifyCall(c: {
  status: string | null
  answered_by: string | null
  disposition_at: string | null
}): CallOutcome {
  if (c.answered_by === 'voicemail') return 'voicemail'
  if (c.answered_by === 'hangup') return 'no_answer'
  if (c.status && NO_ANSWER_STATUSES.has(c.status)) return 'no_answer'
  // The line answered — but only a filed wrap-up makes that a conversation. Without one
  // we genuinely do not know who or what picked up, and claiming a human did is the
  // very thing that inflated these numbers.
  if (c.status === 'completed' && c.disposition_at) return 'connected'
  return 'unknown'
}

/**
 * The inbound equivalent of classifyCall.
 *
 * WHY IT IS SEPARATE: classifyCall leans on the agent's wrap-up, and no inbound call has
 * one — the disposition screen only opens on outbound dials. Run through classifyCall,
 * every single callback would land in 'unknown'. Inbound calls instead carry
 * `inbound_outcome`, written by the routing chain in /api/voice/twilio/incoming as it
 * decides the call's fate, which is a better record than Twilio's status anyway.
 *
 * The '-closed' suffix marks a call that arrived outside business hours, when the chain
 * skips ringing entirely and goes straight to the recorder. It is a flag on top of the
 * outcome, not an outcome of its own, so it is stripped here and counted separately.
 */
export type InboundOutcome = 'answered' | 'voicemail' | 'abandoned'

export function classifyInbound(outcome: string | null): { outcome: InboundOutcome; afterHours: boolean } {
  const raw = (outcome ?? '').trim()
  const afterHours = raw.endsWith('-closed')
  const base = afterHours ? raw.slice(0, -'-closed'.length) : raw
  if (base.startsWith('answered')) return { outcome: 'answered', afterHours }
  if (base === 'voicemail') return { outcome: 'voicemail', afterHours }
  // 'abandoned' is also the value the row is inserted with before routing resolves, so a
  // call still in progress reads as abandoned until it finishes. Anything unrecognised
  // belongs here too: whatever it was, nobody spoke to the caller.
  return { outcome: 'abandoned', afterHours }
}

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
    disposition_at: string | null
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
      .select('created_at, agent_user_id, direction, status, duration_sec, answered_by, disposition_at, interested, appointment_booked, do_not_call, from_number, leads(name, company_name)')
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
      calls: 0, connected: 0, voicemail: 0, no_answer: 0, unknown: 0,
      interested: 0, appointments: 0, talk_sec: 0, connected_talk_sec: 0,
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

  // The inbound half is built from the same range, and answered on the same pool
  // numbers, so it reuses both maps rather than re-reading them.
  const inbound = await buildInbound(service, { fromISO, toISO, agentIds, agentName, numberLabel })

  const byNumber = new Map<string, NumberSummary>()
  const detail: CallDetail[] = []

  for (const r of rows) {
    const id = r.agent_user_id
    // The query already restricts to allowed callers, so every row maps to a
    // seeded summary. Skip defensively if not (shouldn't happen).
    const s = id ? summaries.get(id) : undefined
    if (!s) continue
    const name = s.agent_name
    const outcome = classifyCall(r)
    s.calls++
    // Exclusive by construction, so calls = connected + voicemail + no_answer + unknown.
    if (outcome === 'connected') s.connected++
    else if (outcome === 'voicemail') s.voicemail++
    else if (outcome === 'no_answer') s.no_answer++
    else s.unknown++
    if (r.interested === 'yes') s.interested++
    if (r.appointment_booked) s.appointments++
    s.talk_sec += r.duration_sec ?? 0
    // Kept apart so "avg talk" means seconds per CONVERSATION. Dividing total talk time
    // (which now includes every voicemail greeting) by the connected count would inflate it.
    if (outcome === 'connected') s.connected_talk_sec += r.duration_sec ?? 0

    // Calls placed before the pool recorded a from_number (everything up to Jul 2026)
    // are skipped here rather than bucketed as "unknown": a phantom row carrying a
    // quarter of all historical calls would dominate the table and mean nothing.
    if (r.from_number) {
      let ns = byNumber.get(r.from_number)
      if (!ns) {
        ns = {
          from_number: r.from_number,
          label: numberLabel.get(r.from_number) ?? null,
          calls: 0, connected: 0, voicemail: 0, no_answer: 0, unknown: 0, appointments: 0,
          talk_sec: 0, connected_talk_sec: 0, connect_rate: 0, avg_talk_sec: 0,
        }
        byNumber.set(r.from_number, ns)
      }
      ns.calls++
      if (outcome === 'connected') ns.connected++
      else if (outcome === 'voicemail') ns.voicemail++
      else if (outcome === 'no_answer') ns.no_answer++
      else ns.unknown++
      if (r.appointment_booked) ns.appointments++
      ns.talk_sec += r.duration_sec ?? 0
      if (outcome === 'connected') ns.connected_talk_sec += r.duration_sec ?? 0
    }

    const leadLabel = r.leads?.name || r.leads?.company_name || '—'
    detail.push({
      created_at: r.created_at,
      agent_name: name,
      lead: leadLabel,
      direction: r.direction ?? '',
      status: r.status ?? '',
      outcome,
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
    s.avg_talk_sec = s.connected ? Math.round(s.connected_talk_sec / s.connected) : 0
    s.conversion_rate = s.calls ? Math.round((s.appointments / s.calls) * 100) : 0
  }

  for (const n of byNumber.values()) {
    n.connect_rate = n.calls ? Math.round((n.connected / n.calls) * 100) : 0
    n.avg_talk_sec = n.connected ? Math.round(n.connected_talk_sec / n.connected) : 0
  }

  const summary = [...summaries.values()].sort((a, b) => b.calls - a.calls || a.agent_name.localeCompare(b.agent_name))
  const by_number = [...byNumber.values()].sort((a, b) => b.calls - a.calls || a.from_number.localeCompare(b.from_number))

  return { fromISO, toISO, label, summary, by_number, detail, inbound: inbound.summary, inbound_detail: inbound.detail }
}

/**
 * Build the inbound half of the report over the same range.
 *
 * Split out from buildDialerReport's main loop because inbound rows are a different
 * shape, not a different filter: they carry no wrap-up, no appointment and no
 * duration_sec, and their from_number is the lead rather than one of ours.
 *
 * TALK TIME comes from `call_length_min` (the recording's length), because duration_sec
 * is NULL on every inbound row ever written — the <Dial action> callback on an inbound
 * call goes back to /incoming to drive the next routing stage, not to /status, so
 * nothing records the dial duration. The recording covers the conversation itself, so
 * it is a close proxy; it is absent on abandoned calls, which have no conversation to
 * measure anyway.
 *
 * SCOPE: when `agentIds` is given (a manager's team, or an agent seeing themselves)
 * only calls involving those people are included, since the caller's role decides what
 * they may see exactly as it does outbound. Unscoped, every callback counts — including
 * the ones from numbers nobody recognised, which have no agent at all and which are
 * precisely the ones worth noticing.
 */
async function buildInbound(
  service: SupabaseClient,
  opts: {
    fromISO: string | null
    toISO: string | null
    agentIds?: string[] | null
    agentName: Map<string, string>
    numberLabel: Map<string, string | null>
  },
): Promise<{ summary: InboundSummary; detail: InboundDetail[] }> {
  const { fromISO, toISO, agentIds, agentName, numberLabel } = opts
  const scoped = Array.isArray(agentIds)

  type Row = {
    created_at: string
    agent_user_id: string | null
    inbound_outcome: string | null
    call_length_min: number | null
    from_number: string | null
    to_number: string | null
    leads: { name: string | null; company_name: string | null } | null
  }

  const rows: Row[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    let q = service
      .from('voice_calls')
      .select('created_at, agent_user_id, inbound_outcome, call_length_min, from_number, to_number, leads(name, company_name)')
      .eq('provider', 'twilio')
      .eq('direction', 'inbound')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (fromISO) q = q.gte('created_at', fromISO)
    if (toISO) q = q.lt('created_at', toISO)
    if (scoped) {
      const ids = agentIds!.length ? agentIds! : ['00000000-0000-0000-0000-000000000000']
      q = q.in('agent_user_id', ids)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }

  const summary: InboundSummary = {
    received: 0, answered: 0, answered_owner: 0, answered_hunt: 0,
    voicemail: 0, abandoned: 0, after_hours: 0,
    answer_rate: 0, talk_sec: 0, avg_talk_sec: 0,
    by_agent: [], by_line: [],
  }

  const byAgent = new Map<string, InboundAgentSummary>()
  const byLine = new Map<string, InboundLineSummary>()
  const detail: InboundDetail[] = []

  for (const r of rows) {
    const { outcome, afterHours } = classifyInbound(r.inbound_outcome)
    // Only answered calls have a conversation to time; a voicemail's recording is the
    // caller talking to a machine and would inflate "talk time" if it were added in.
    const talk = outcome === 'answered' ? Math.round((r.call_length_min ?? 0) * 60) : 0

    summary.received++
    if (outcome === 'answered') {
      summary.answered++
      if ((r.inbound_outcome ?? '').startsWith('answered-owner')) summary.answered_owner++
      else summary.answered_hunt++
      summary.talk_sec += talk
    } else if (outcome === 'voicemail') summary.voicemail++
    else summary.abandoned++
    if (afterHours) summary.after_hours++

    // Per agent: answered calls only. See InboundAgentSummary for why misses are not
    // attributed. A row with no agent (an unknown caller nobody had dialed) simply has
    // nowhere to go, which is correct — it was handled by no one.
    if (outcome === 'answered' && r.agent_user_id) {
      let a = byAgent.get(r.agent_user_id)
      if (!a) {
        a = {
          agent_id: r.agent_user_id,
          agent_name: agentName.get(r.agent_user_id) ?? '(unnamed)',
          answered: 0, answered_owner: 0, answered_hunt: 0, talk_sec: 0, avg_talk_sec: 0,
        }
        byAgent.set(r.agent_user_id, a)
      }
      a.answered++
      if ((r.inbound_outcome ?? '').startsWith('answered-owner')) a.answered_owner++
      else a.answered_hunt++
      a.talk_sec += talk
    }

    // Per line: the pool number they rang back on.
    if (r.to_number) {
      let l = byLine.get(r.to_number)
      if (!l) {
        l = {
          to_number: r.to_number,
          label: numberLabel.get(r.to_number) ?? null,
          received: 0, answered: 0, voicemail: 0, abandoned: 0, after_hours: 0,
          answer_rate: 0, talk_sec: 0,
        }
        byLine.set(r.to_number, l)
      }
      l.received++
      if (outcome === 'answered') { l.answered++; l.talk_sec += talk }
      else if (outcome === 'voicemail') l.voicemail++
      else l.abandoned++
      if (afterHours) l.after_hours++
    }

    const line = r.to_number
      ? (numberLabel.get(r.to_number) ? `${numberLabel.get(r.to_number)} (${r.to_number})` : r.to_number)
      : ''
    detail.push({
      created_at: r.created_at,
      lead: r.leads?.name || r.leads?.company_name || '—',
      from_number: r.from_number ?? '',
      line,
      outcome: r.inbound_outcome ?? '',
      handled_by: outcome === 'answered' && r.agent_user_id ? (agentName.get(r.agent_user_id) ?? '(unnamed)') : '',
      duration_sec: talk,
    })
  }

  summary.answer_rate = summary.received ? Math.round((summary.answered / summary.received) * 100) : 0
  summary.avg_talk_sec = summary.answered ? Math.round(summary.talk_sec / summary.answered) : 0

  for (const a of byAgent.values()) {
    a.avg_talk_sec = a.answered ? Math.round(a.talk_sec / a.answered) : 0
  }
  for (const l of byLine.values()) {
    l.answer_rate = l.received ? Math.round((l.answered / l.received) * 100) : 0
  }

  summary.by_agent = [...byAgent.values()].sort((a, b) => b.answered - a.answered || a.agent_name.localeCompare(b.agent_name))
  summary.by_line = [...byLine.values()].sort((a, b) => b.received - a.received || a.to_number.localeCompare(b.to_number))

  return { summary, detail }
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
  lines.push(csvRow(['Agent', 'Calls', 'Connected', 'Connect %', 'Voicemail', 'No answer', 'Unmarked', 'Interested', 'Appointments', 'Conversion %', 'Talk time', 'Avg talk/call']))
  for (const s of report.summary) {
    lines.push(csvRow([s.agent_name, s.calls, s.connected, `${s.connect_rate}%`, s.voicemail, s.no_answer, s.unknown, s.interested, s.appointments, `${s.conversion_rate}%`, fmtDuration(s.talk_sec), fmtDuration(s.avg_talk_sec)]))
  }
  lines.push('')

  // Only when there is something to show: a range made up entirely of pre-Aug-2026
  // calls has no from_number on any row, and an empty headed block reads like a bug.
  if (report.by_number.length > 0) {
    lines.push('PER-NUMBER SUMMARY')
    lines.push(csvRow(['Called from', 'Number', 'Calls', 'Connected', 'Connect %', 'Voicemail', 'No answer', 'Unmarked', 'Appointments', 'Talk time', 'Avg talk/call']))
    for (const n of report.by_number) {
      lines.push(csvRow([n.label ?? '—', n.from_number, n.calls, n.connected, `${n.connect_rate}%`, n.voicemail, n.no_answer, n.unknown, n.appointments, fmtDuration(n.talk_sec), fmtDuration(n.avg_talk_sec)]))
    }
    lines.push('')
  }

  // Inbound is reported apart from the outbound blocks above rather than merged into
  // them: a callback is not an agent's dialling effort, its outcomes come from a
  // different column, and folding the two together would quietly move the connect rate.
  if (report.inbound.received > 0) {
    const ib = report.inbound
    lines.push('INBOUND SUMMARY')
    lines.push(csvRow(['Received', 'Answered', 'Answer %', 'By owner', 'By team', 'Voicemail', 'Missed', 'After hours', 'Talk time', 'Avg talk/call']))
    lines.push(csvRow([ib.received, ib.answered, `${ib.answer_rate}%`, ib.answered_owner, ib.answered_hunt, ib.voicemail, ib.abandoned, ib.after_hours, fmtDuration(ib.talk_sec), fmtDuration(ib.avg_talk_sec)]))
    lines.push('')

    if (ib.by_agent.length > 0) {
      lines.push('INBOUND ANSWERED BY AGENT')
      lines.push(csvRow(['Agent', 'Answered', 'As owner', 'From hunt group', 'Talk time', 'Avg talk/call']))
      for (const a of ib.by_agent) {
        lines.push(csvRow([a.agent_name, a.answered, a.answered_owner, a.answered_hunt, fmtDuration(a.talk_sec), fmtDuration(a.avg_talk_sec)]))
      }
      lines.push('')
    }

    if (ib.by_line.length > 0) {
      lines.push('INBOUND BY LINE')
      lines.push(csvRow(['Line', 'Number', 'Received', 'Answered', 'Answer %', 'Voicemail', 'Missed', 'After hours', 'Talk time']))
      for (const l of ib.by_line) {
        lines.push(csvRow([l.label ?? '—', l.to_number, l.received, l.answered, `${l.answer_rate}%`, l.voicemail, l.abandoned, l.after_hours, fmtDuration(l.talk_sec)]))
      }
      lines.push('')
    }
  }

  lines.push('CALL DETAIL')
  lines.push(csvRow(['Time', 'Agent', 'Lead', 'Called from', 'Direction', 'Outcome', 'Twilio status', 'Duration', 'Answered by', 'Interested', 'Appointment', 'Do not call']))
  for (const d of report.detail) {
    lines.push(csvRow([d.created_at, d.agent_name, d.lead, d.from_number, d.direction, d.outcome, d.status, fmtDuration(d.duration_sec), d.answered_by, d.interested, d.appointment, d.do_not_call]))
  }

  if (report.inbound_detail.length > 0) {
    lines.push('')
    lines.push('INBOUND CALL DETAIL')
    lines.push(csvRow(['Time', 'Lead', 'Caller number', 'Line called', 'Outcome', 'Answered by', 'Duration']))
    for (const d of report.inbound_detail) {
      lines.push(csvRow([d.created_at, d.lead, d.from_number, d.line, d.outcome, d.handled_by, fmtDuration(d.duration_sec)]))
    }
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
      <td ${tdNum}>${s.unknown}</td>
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
          <th ${th} style="text-align:right">Unmarked</th>
          <th ${th} style="text-align:right">Appts</th>
          <th ${th} style="text-align:right">Conv %</th>
          <th ${th} style="text-align:right">Talk time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px">
      <strong>Connected</strong> means a human was reached — the line answered and the agent filed a wrap-up.
      Calls that rolled to voicemail are counted under Voicemail only, never as connected.
      <strong>Unmarked</strong> is answered calls where the wrap-up was skipped, so we cannot tell:
      they are excluded from Connected, and the number should be close to zero.
    </p>
    ${inboundSummaryHtml(report)}
    <p style="color:#94a3b8;font-size:12px;margin-top:8px">Full per-call detail is attached as a CSV.</p>
  </div>`
}

/**
 * The inbound block of the daily email.
 *
 * Deliberately headline-first rather than a per-agent table: the number worth waking up
 * to is how many callbacks nobody took, and that figure belongs to the team, not to a
 * name (see InboundAgentSummary). Missed calls are coloured only when there are any, so
 * a clean day stays visually quiet.
 *
 * Returns an empty string when no callbacks arrived, so a team that only dials out sees
 * the email it has always seen.
 */
function inboundSummaryHtml(report: DialerReport): string {
  const ib = report.inbound
  if (ib.received === 0) return ''

  const cell = 'style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums"'
  const head = 'style="text-align:right;padding:6px 12px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#475569"'
  const missedColor = ib.abandoned > 0 ? '#b91c1c' : '#0f172a'

  const agentRows = ib.by_agent.map(a => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:left">${escapeHtml(a.agent_name)}</td>
      <td ${cell}>${a.answered}</td>
      <td ${cell}>${a.answered_owner}</td>
      <td ${cell}>${a.answered_hunt}</td>
      <td ${cell}>${fmtDuration(a.talk_sec)}</td>
    </tr>`).join('')

  return `
    <h3 style="color:#0f172a;font-size:15px;margin:28px 0 4px">Inbound — callbacks received</h3>
    <table style="border-collapse:collapse;width:100%;max-width:680px;margin-top:8px">
      <thead>
        <tr>
          <th ${head}>Received</th>
          <th ${head}>Answered</th>
          <th ${head}>Answer %</th>
          <th ${head}>Voicemail</th>
          <th ${head}>Missed</th>
          <th ${head}>After hours</th>
          <th ${head}>Talk time</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td ${cell}>${ib.received}</td>
          <td ${cell}>${ib.answered}</td>
          <td ${cell}>${ib.answer_rate}%</td>
          <td ${cell}>${ib.voicemail}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;color:${missedColor};font-weight:${ib.abandoned > 0 ? '700' : '400'}">${ib.abandoned}</td>
          <td ${cell}>${ib.after_hours}</td>
          <td ${cell}>${fmtDuration(ib.talk_sec)}</td>
        </tr>
      </tbody>
    </table>
    ${agentRows ? `
    <table style="border-collapse:collapse;width:100%;max-width:680px;margin-top:12px">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#475569">Answered by</th>
          <th ${head}>Calls</th>
          <th ${head}>As owner</th>
          <th ${head}>From hunt</th>
          <th ${head}>Talk time</th>
        </tr>
      </thead>
      <tbody>${agentRows}</tbody>
    </table>` : ''}
    <p style="color:#94a3b8;font-size:12px;margin-top:12px">
      <strong>Missed</strong> is a callback where nobody picked up and no message was left — the
      warmest traffic the team gets, lost. These are counted for the team rather than against an
      individual, because on a hunt-group call everyone's phone rings.
      <strong>Talk time</strong> is measured from the call recording, the only length recorded on
      an inbound call.
    </p>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
