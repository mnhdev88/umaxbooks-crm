export type UserRole = 'admin' | 'agent' | 'sales_agent' | 'sales_manager' | 'developer' | 'client'

export type LeadSource =
  | 'GMB'
  | 'Facebook'
  | 'LinkedIn'
  | 'WhatsApp'
  | 'Referral'
  | 'Cold Call'
  | 'Website Form'
  | 'Subscriber'
  | 'Other'

export const LEAD_SOURCES: LeadSource[] = [
  'GMB', 'Facebook', 'LinkedIn', 'WhatsApp',
  'Referral', 'Cold Call', 'Website Form', 'Subscriber', 'Other',
]

export type LeadPriority = 'Normal' | 'High' | 'Urgent' | 'Low'

export type PipelineStatus =
  | 'New'
  | 'Contacted'
  | 'Audit Ready'
  | 'Callback Booked'
  | 'Demo Scheduled'
  | 'Demo Done'
  | 'Closed Won'
  | 'Revision'
  | 'Live'
  | 'Completed'
  | 'Lost'
  | 'Disqualified'

export const PIPELINE_STAGES: PipelineStatus[] = [
  'New',
  'Contacted',
  'Audit Ready',
  'Callback Booked',
  'Demo Scheduled',
  'Demo Done',
  'Closed Won',
  'Revision',
  'Live',
  'Completed',
  'Disqualified',
]

export type PaymentStatus = 'Pending' | 'Partial' | 'Paid' | 'Overdue'

export type ServiceType =
  | 'Website Design'
  | 'SEO'
  | 'Google Ads'
  | 'Social Media'
  | 'GMB Optimization'
  | 'Content Writing'
  | 'Email Marketing'
  | 'Video Production'
  | 'Branding'
  | 'Other'

export const SERVICE_OPTIONS: ServiceType[] = [
  'Website Design',
  'SEO',
  'Google Ads',
  'Social Media',
  'GMB Optimization',
  'Content Writing',
  'Email Marketing',
  'Video Production',
  'Branding',
  'Other',
]

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  manager_id?: string | null
  avatar_url?: string
  lead_id?: string
  last_seen_at?: string | null
  created_at: string
}

/** One extra email/phone on a lead (leads.alt_emails / alt_phones jsonb arrays). */
export interface LeadAltContact {
  value: string
  label?: string
}

export interface Lead {
  id: string
  name: string
  company_name: string
  business_type?: string
  address?: string
  zip_code?: string
  city?: string
  country?: string
  website_url?: string
  website_status?: string
  social_url?: string
  whatsapp_number?: string
  gmb_review_rating?: number
  gmb_category?: string
  number_of_reviews?: number
  gmb_url?: string
  gmb_last_seen?: string
  competitor_count?: number
  competitor_notes?: string
  phone?: string
  email?: string
  alt_phones?: LeadAltContact[]
  alt_emails?: LeadAltContact[]
  email_verdict?: 'Valid' | 'Risky' | 'Invalid' | string
  email_score?: number
  email_validated_at?: string
  source?: LeadSource
  status: PipelineStatus
  priority?: LeadPriority
  assigned_agent_id?: string
  assigned_agent?: Profile
  notes?: string
  agent_private_notes?: string
  custom_field_1_label?: string
  custom_field_1_value?: string
  custom_field_2_label?: string
  custom_field_2_value?: string
  follow_up_step?: number
  follow_up_paused?: boolean
  last_followup_sent_at?: string
  created_at: string
  updated_at: string
  slug: string
  lead_number?: number
}

export interface Audit {
  id: string
  lead_id: string
  sitemap_pdf_url?: string
  audit_short_pdf_url?: string
  audit_long_pdf_url?: string
  score?: number
  scrape_data?: {
    website?: Record<string, any> | null
    gmb?: Record<string, any> | null
  }
  file_names?: {
    sitemap?: string
    short?: string
    long?: string
  }
  agent_notes?: string
  developer_notes_short?: string
  developer_notes_long?: string
  short_uploaded_by?: string
  long_uploaded_by?: string
  short_uploaded_at?: string
  long_uploaded_at?: string
  short_file_size?: number
  long_file_size?: number
  tat_days?: number
  created_at: string
  created_by: string
  created_by_profile?: Profile
  short_uploader?: Profile
  long_uploader?: Profile
}

export interface Appointment {
  id: string
  lead_id: string
  call_date?: string
  outcome_notes?: string
  appointment_datetime?: string
  zoom_link?: string
  client_requirements?: string
  timezone?: string
  created_at: string
  created_by: string
}

export interface ProjectApproval {
  id: string
  appointment_id?: string
  lead_id: string
  status: 'pending' | 'approved' | 'declined'
  client_requirements?: string
  approved_by?: string
  approved_at?: string
  due_date?: string
  created_at: string
  lead?: Lead
  appointment?: Appointment
  approver?: Profile
}

export interface Demo {
  id: string
  lead_id: string
  developer_id?: string
  developer?: Profile
  temp_url?: string
  demo_version?: string
  upload_date?: string
  created_at: string
}

export interface Deal {
  id: string
  lead_id: string
  services: ServiceType[]
  start_date?: string
  end_date?: string
  duration_days?: number
  token_amount?: number
  final_payment_amount?: number
  payment_status: PaymentStatus
  created_at: string
  updated_at: string
}

export interface Revision {
  id: string
  lead_id: string
  client_photos_urls: string[]
  phone?: string
  email?: string
  owner_photo_url?: string
  custom_notes?: string
  version_label: 'v1' | 'v2' | 'v3'
  created_at: string
  created_by: string
}

export interface LiveSite {
  id: string
  lead_id: string
  final_url?: string
  go_live_date?: string
  hosting_provider?: string
  domain_status?: string
  domain_registrar?: string
  domain_expiry?: string
  hosting_expiry?: string
  ssl_expiry?: string
  hosting_cpanel_url?: string
  maintenance_plan?: boolean
  maintenance_renewal_date?: string
  maintenance_monthly_amt?: number
  created_at: string
  updated_at: string
}

export interface ClientEmail {
  id: string
  lead_id: string
  email_address: string
  label?: string
  provider?: string
  created_at: string
}

export interface SupportRequest {
  id: string
  lead_id: string
  client_id: string
  title: string
  description?: string
  type: 'revision' | 'bug' | 'content' | 'other'
  status: 'open' | 'in_progress' | 'resolved'
  developer_note?: string
  created_at: string
  updated_at: string
}

export interface ActivityLog {
  id: string
  lead_id: string
  user_id: string
  user?: Profile
  action: string
  details?: string
  created_at: string
}

export interface VoiceCall {
  id: string
  lead_id: string | null
  call_id: string | null
  answered_by: string | null
  completed: boolean | null
  call_length_min: number | null
  recording_url: string | null
  transcript: string | null
  summary: string | null
  interested: 'yes' | 'no' | 'maybe' | null
  objection: string | null
  do_not_call: boolean | null
  appointment_booked: boolean | null
  appointment_time: string | null
  callback_requested: boolean | null
  callback_time: string | null
  has_website: boolean | null
  current_website: string | null
  budget_mentioned: string | null
  decision_maker: boolean | null
  notes: string | null
  extracted: Record<string, unknown> | null
  // Provider-aware fields (Twilio human dialer; default 'bland' for AI calls — see migration 050)
  provider: string | null            // 'bland' | 'twilio'
  direction: string | null           // 'outbound' | 'inbound'
  status: string | null              // Twilio DialCallStatus: completed/busy/no-answer/failed/canceled
  duration_sec: number | null        // exact call seconds (Twilio dialer)
  agent_user_id: string | null       // staff member who placed a dialer call
  agent?: { full_name: string | null } | null // joined in views; not a column
  created_at: string
}

export interface FollowUpStep {
  id: string
  lead_id: string
  step_number: number
  status: 'pending' | 'active' | 'done' | 'skipped'
  outcome?: string
  notes?: string
  scheduled_at?: string
  completed_at?: string
  zoom_link?: string
  created_by?: string
  created_at: string
}

export interface ContentItem {
  id: string
  type: 'pdf' | 'blog' | 'link' | 'image' | 'email_template'
  title: string
  description?: string
  url?: string
  file_url?: string
  lead_id?: string
  created_by?: string
  created_at: string
}

export interface ContentSend {
  id: string
  lead_id: string
  user_id: string
  content_ids: string[]
  channel: 'whatsapp' | 'email' | 'both'
  message?: string
  scheduled_at?: string
  sent_at?: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  lead_id?: string
  lead?: Lead
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  read: boolean
  link?: string
  created_at: string
  user?: { full_name: string; role: string } | null
}

// ── Chat (staff DMs) ────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string
  body: string | null
  created_at: string
  attachment_path?: string | null
  attachment_name?: string | null
  attachment_type?: string | null
  attachment_size?: number | null
}

// A conversation as shown in the list, with the other participant resolved
// (for 1:1 DMs) and a computed unread flag.
export interface ChatConversation {
  id: string
  is_group: boolean
  title: string | null
  last_message_at: string
  created_at: string
  other: ChatContact | null
  last_message?: string | null
  unread: boolean
}

// A staff member you can start a DM with.
export type ChatContact = Pick<Profile, 'id' | 'full_name' | 'role' | 'avatar_url' | 'last_seen_at'>

export interface BeforeAfterComparison {
  id: string
  lead_id: string
  before_screenshot_url?: string
  after_screenshot_url?: string
  developer_summary?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface BeforeAfterMetric {
  id: string
  lead_id: string
  metric_name: string
  before_value?: string
  after_value?: string
  business_impact?: string
  sort_order: number
  created_at: string
}

export interface DealClosing {
  id: string
  lead_id: string
  outcome: 'pending' | 'won' | 'lost'
  payment_type?: string
  token_amount?: number
  payment_method?: string
  transaction_id?: string
  services: string[]
  start_date?: string
  end_date?: string
  duration_days?: number
  client_phone?: string
  client_email?: string
  revision_notes?: string
  closing_call_notes?: string
  lost_reason?: string
  lost_notes?: string
  re_nurture_date?: string
  re_nurture_action?: string
  prep_checklist: Record<string, boolean>
  closed_by?: string
  closed_at?: string
  created_at: string
  updated_at: string
}

export interface LeadContactNote {
  id: string
  lead_id: string
  user_id: string
  author?: Pick<Profile, 'full_name' | 'role'>
  contact_date: string
  note: string
  created_at: string
}

export interface DemoApproval {
  id: string
  lead_id: string
  checklist: Record<string, boolean>
  auditor_id?: string
  auditor?: Profile
  auditor_notes?: string
  deadline?: string
  status: 'pending' | 'approved' | 'rejected'
  result_notes?: string
  reviewed_at?: string
  created_at: string
  updated_at: string
}
