import type { SupabaseClient } from '@supabase/supabase-js'
import { parseReportDayConfig, type ReportDayConfig } from './reporting-day'

// Read the business reporting-day config (timezone + day-start hour) from
// app_settings. The two keys are authenticated-readable, so the caller's normal
// server client works — no service client needed.
export async function getReportDayConfig(client: SupabaseClient): Promise<ReportDayConfig> {
  const { data } = await client
    .from('app_settings')
    .select('key, value')
    .in('key', ['report_timezone', 'report_day_start_hour'])
  const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]))
  return parseReportDayConfig(map['report_timezone'], map['report_day_start_hour'])
}
