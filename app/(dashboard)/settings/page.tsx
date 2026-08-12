import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { UserManagement } from '@/components/settings/UserManagement'
import { EmailProviders } from '@/components/settings/EmailProviders'
import { EmailTemplates } from '@/components/settings/EmailTemplates'
import { AutomatedEmailSetting } from '@/components/settings/AutomatedEmailSetting'
import { CallTargetSetting } from '@/components/settings/CallTargetSetting'
import { CallWindowSetting } from '@/components/settings/CallWindowSetting'
import { BusinessHoursSetting } from '@/components/settings/BusinessHoursSetting'
import { CallerNumbers } from '@/components/settings/CallerNumbers'
import { RingtoneSetting } from '@/components/settings/RingtoneSetting'
import { RingtonePreference } from '@/components/settings/RingtonePreference'
import { ReportingDaySetting } from '@/components/settings/ReportingDaySetting'
import { KpiScorecardSettings } from '@/components/settings/KpiScorecardSettings'
import { ManualKpiEntries } from '@/components/settings/ManualKpiEntries'
import { ContractPackageDefaults } from '@/components/settings/ContractPackageDefaults'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  // Everyone reaches this page now — it carries the per-agent ringtone preference, which
  // is no use to an agent behind an admin-only redirect. Every other block below is still
  // admin-only, gated individually rather than by turning the whole page away.
  const isAdmin = profile.role === 'admin'

  // Only fetched for the admin block that needs it; agents have no business listing staff.
  const { data: users } = isAdmin
    ? await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    : { data: null }

  return (
    <>
      <Header title="Settings" profile={profile as Profile} />
      <div className="p-6 max-w-3xl space-y-6">
        <RingtonePreference />
        {isAdmin && (
          <>
            <UserManagement users={(users || []) as Profile[]} currentUserId={user.id} />
            <AutomatedEmailSetting />
            <CallTargetSetting />
            <CallWindowSetting />
            <BusinessHoursSetting />
            <CallerNumbers />
            <RingtoneSetting />
            <ReportingDaySetting />
            <ContractPackageDefaults />
            <KpiScorecardSettings />
            <ManualKpiEntries
              staff={((users || []) as Profile[])
                .filter(u => ['agent', 'sales_agent', 'sales_manager'].includes(u.role))
                .map(u => ({ id: u.id, full_name: u.full_name, role: u.role }))}
            />
            <EmailProviders />
            <EmailTemplates />
          </>
        )}
      </div>
    </>
  )
}
