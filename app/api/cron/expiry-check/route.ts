import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date()
  const in30  = new Date(today)
  in30.setDate(in30.getDate() + 30)
  const in30Str = in30.toISOString().split('T')[0]

  const expiryFields = [
    { column: 'domain_expiry',            type: 'domain',      label: 'Domain' },
    { column: 'hosting_expiry',           type: 'hosting',     label: 'Hosting' },
    { column: 'ssl_expiry',               type: 'ssl',         label: 'SSL Certificate' },
    { column: 'maintenance_renewal_date', type: 'maintenance', label: 'Maintenance Plan' },
  ] as const

  let totalSent = 0

  for (const { column, type, label } of expiryFields) {
    const { data: sites } = await supabase
      .from('live_sites')
      .select(`id, lead_id, ${column}, leads!inner(name, company_name, assigned_agent_id, email)`)
      .eq(column, in30Str)

    if (!sites?.length) continue

    for (const site of sites as any[]) {
      const leadInfo = site.leads

      // Skip if we already sent this reminder
      const { data: alreadySent } = await supabase
        .from('expiry_reminders_sent')
        .select('id')
        .eq('lead_id', site.lead_id)
        .eq('expiry_type', type)
        .eq('days_before', 30)
        .maybeSingle()

      if (alreadySent) continue

      // Notify all admins via in-app notifications
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      if (admins?.length) {
        await supabase.from('notifications').insert(
          admins.map(admin => ({
            user_id: admin.id,
            lead_id: site.lead_id,
            title:   `${label} Expiring in 30 Days`,
            message: `${leadInfo.company_name}'s ${label.toLowerCase()} expires on ${in30Str}. Renew before it lapses.`,
            type:    'warning',
          }))
        )
      }

      // Notify the client if they have a portal account
      const { data: clientProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('lead_id', site.lead_id)
        .eq('role', 'client')
        .maybeSingle()

      if (clientProfile) {
        await supabase.from('notifications').insert({
          user_id: clientProfile.id,
          lead_id: site.lead_id,
          title:   `Your ${label} Expires in 30 Days`,
          message: `Your ${label.toLowerCase()} is due for renewal on ${in30Str}. We will handle this — no action needed from you.`,
          type:    'warning',
        })
      }

      // Log so we don't send duplicate reminders
      await supabase.from('expiry_reminders_sent').insert({
        lead_id:     site.lead_id,
        expiry_type: type,
        days_before: 30,
      })

      totalSent++
    }
  }

  return NextResponse.json({ ok: true, date_checked: in30Str, reminders_sent: totalSent })
}
