import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, buildDemoScheduledEmail, buildRevisionEmail } from '@/lib/notifications'
import { automatedEmailEnabled } from '@/lib/automated-email'

export async function POST(req: NextRequest) {
  const { leadId, newStatus } = await req.json()

  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name, email)')
    .eq('id', leadId)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Get all developers
  const { data: developers } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'developer')

  if (!developers?.length) return NextResponse.json({ ok: true })

  // Get latest revision notes if Revision status
  let revisionNotes = ''
  if (newStatus === 'Revision') {
    const { data: rev } = await supabase
      .from('revisions')
      .select('custom_notes')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    revisionNotes = rev?.custom_notes || ''
  }

  // In-app notifications always fire; the email copy is held when automated email is off.
  const emailAllowed = await automatedEmailEnabled()

  for (const dev of developers) {
    // Create in-app notification
    await supabase.from('notifications').insert({
      user_id: dev.id,
      lead_id: leadId,
      title: newStatus === 'Demo Scheduled' ? 'Demo Scheduled' : 'Revision Requested',
      message: newStatus === 'Demo Scheduled'
        ? `${lead.company_name} has moved to Demo Scheduled stage.`
        : `${lead.company_name} requires revision. Notes: ${revisionNotes || 'See CRM.'}`,
      type: 'info',
    })

    // Send email
    if (emailAllowed && dev.email) {
      const emailContent = newStatus === 'Demo Scheduled'
        ? buildDemoScheduledEmail(lead.name, lead.company_name, dev.full_name)
        : buildRevisionEmail(lead.name, lead.company_name, dev.full_name, revisionNotes)

      await sendEmail({ to: dev.email, ...emailContent })
    }
  }

  return NextResponse.json({ ok: true, emailsPaused: !emailAllowed })
}
