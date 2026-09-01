import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { SettingsTabs, type SettingsTab } from '@/components/settings/SettingsTabs'
import { CALL_SETTINGS_ROLES } from '@/lib/settings-access'
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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  // Read on the server so a shared /settings?tab=email link renders that tab in the
  // first paint, instead of flashing the default tab and swapping after hydration.
  const tabParam = (await searchParams).tab
  const initialTab = Array.isArray(tabParam) ? tabParam[0] : tabParam

  // Everyone reaches this page now — it carries the per-agent ringtone preference, which
  // is no use to an agent behind an admin-only redirect. The rest is gated per tab
  // rather than by turning the whole page away.
  const isAdmin = profile.role === 'admin'
  // Sales staff get the Calls tab too — the pool, calling window and daily target are
  // what the people doing the dialling need. They can edit, not just read: the matching
  // API routes use the same list. See lib/settings-access.ts.
  const canSeeCallSettings = (CALL_SETTINGS_ROLES as readonly string[]).includes(profile.role)

  // Only fetched for the admin block that needs it; agents have no business listing staff.
  const { data: users } = isAdmin
    ? await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    : { data: null }

  const staff = ((users || []) as Profile[])

  // Grouped by what an admin came here to change, not by which table each one writes to.
  // Personal preference sits in General alongside the company-wide basics; the two
  // heaviest cards (Caller Numbers, Email Providers) are deliberately in separate tabs
  // so no single tab carries both.
  const callsTab: SettingsTab = {
    id: 'calls',
    label: 'Calls',
    content: (
      <>
        <CallerNumbers />
        <CallWindowSetting />
        <CallTargetSetting />
        <RingtoneSetting />
      </>
    ),
  }

  const adminTabs: SettingsTab[] = [
    {
      id: 'general',
      label: 'General',
      content: (
        <>
          <RingtonePreference />
          <BusinessHoursSetting />
          <ReportingDaySetting />
          <ContractPackageDefaults />
        </>
      ),
    },
    {
      id: 'team',
      label: 'Team',
      content: <UserManagement users={staff} currentUserId={user.id} />,
    },
    callsTab,
    {
      id: 'email',
      label: 'Email',
      content: (
        <>
          <AutomatedEmailSetting />
          <EmailProviders />
          <EmailTemplates />
        </>
      ),
    },
    {
      id: 'reports',
      label: 'Reports',
      content: (
        <>
          <KpiScorecardSettings />
          <ManualKpiEntries
            staff={staff
              .filter(u => ['agent', 'sales_agent', 'sales_manager'].includes(u.role))
              .map(u => ({ id: u.id, full_name: u.full_name, role: u.role }))}
          />
        </>
      ),
    },
  ]

  // A non-admin with call access gets their own preference alongside the Calls tab —
  // General is admin-only, and the ringtone preference is the one card everybody has.
  const salesTabs: SettingsTab[] = [
    { id: 'general', label: 'General', content: <RingtonePreference /> },
    callsTab,
  ]

  const tabs = isAdmin ? adminTabs : canSeeCallSettings ? salesTabs : []

  return (
    <>
      <Header title="Settings" profile={profile as Profile} />
      {/* Wider than the old max-w-3xl now that the tables (Caller Numbers, Team) get a
          tab to themselves rather than sharing a narrow column with twelve other cards. */}
      <div className="p-6 max-w-5xl">
        {tabs.length > 0 ? (
          <SettingsTabs tabs={tabs} initialTab={initialTab} />
        ) : (
          // One card is not worth a tab bar. Developers and clients land here.
          <div className="space-y-6">
            <RingtonePreference />
          </div>
        )}
      </div>
    </>
  )
}
