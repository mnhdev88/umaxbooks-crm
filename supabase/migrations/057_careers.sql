-- Careers: the CRM becomes the source of truth for noveliotech.com/careers.
--
-- The public website fetches open roles from GET /api/public/careers and posts
-- applications to POST /api/public/careers/apply (both whitelisted via the
-- existing /api/public proxy rule). Admins manage postings and review
-- applications on the CRM's /careers page.

-- ── Job postings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_postings (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title             TEXT NOT NULL,
  region            TEXT NOT NULL CHECK (region IN ('us', 'india')),
  openings          INT  NOT NULL DEFAULT 1,
  job_location      TEXT,                 -- display string, e.g. 'Gurgaon, Delhi NCR | Work from Office'
  shift             TEXT,                 -- e.g. 'Hybrid' | 'Night Shift' | 'Day Shift'
  description       TEXT,
  pills             TEXT[] DEFAULT '{}',  -- skill/requirement chips shown on the card
  apply_note_title  TEXT,                 -- optional "How to Apply" callout (SEO roles)
  apply_note_points TEXT[],
  apply_note_footer TEXT,
  footer_note       TEXT,                 -- e.g. 'Send your work profile to: ajay@noveliotech.com'
  btn_label         TEXT,                 -- e.g. 'Send Work Profile →' (site defaults to 'Apply Now →')
  is_active         BOOLEAN DEFAULT TRUE,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

-- The public site reads through the service-role API route (bypasses RLS).
CREATE POLICY "Authenticated users can view job postings"
  ON job_postings FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage job postings"
  ON job_postings FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Applications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_applications (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id           UUID REFERENCES job_postings(id) ON DELETE SET NULL,
  job_title        TEXT,                  -- denormalized so history survives posting deletion
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  linkedin         TEXT,
  cover            TEXT,                  -- "Why this role?"
  -- SEO-role work profile fields
  responsibilities TEXT,
  seo_tasks        TEXT,
  live_urls        TEXT,
  results          TEXT,
  tools            TEXT,
  resume_url       TEXT,                  -- public URL in the crm-files bucket
  status           TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'interview', 'hired', 'rejected')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_applications_job_id_idx ON job_applications(job_id);
CREATE INDEX IF NOT EXISTS job_applications_status_idx ON job_applications(status);

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- Inserts come from the public API route with the service-role key (bypasses RLS).
CREATE POLICY "Authenticated users can view job applications"
  ON job_applications FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage job applications"
  ON job_applications FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Seed: current openings hardcoded on noveliotech.com/careers ─────────────
INSERT INTO job_postings (title, region, openings, job_location, shift, description, pills, apply_note_title, apply_note_points, apply_note_footer, footer_note, btn_label, sort_order) VALUES
(
  'Sales Coordinator', 'us', 1,
  'Dover, DE | Texas | Florida | North Carolina | Tennessee | Idaho | South Dakota | Iowa | Colorado | Utah | Montana',
  'Hybrid',
  'You will coordinate between our sales team, clients, and delivery teams — keeping deals moving, follow-ups on track, and every small business owner we work with feeling taken care of. This role sits at the centre of our US operations and reports directly to the US team lead.',
  ARRAY['CRM Management', 'Client Communication', 'Sales Support', '1–3 Years Experience', 'Full-Time', 'Salary + Incentive'],
  NULL, NULL, NULL, NULL, NULL, 1
),
(
  'Sales Executive', 'us', 3,
  'Dover, DE | Texas | Florida | North Carolina | Tennessee | Idaho | South Dakota | Iowa | Colorado | Utah | Montana',
  'Hybrid',
  'Work directly with small business owners and entrepreneurs — understand their growth challenges, present our digital solutions, and close deals. This is a hybrid field + phone role. You will build your own book of business with full support from a senior sales mentor.',
  ARRAY['B2B Sales', 'Small Business Market', 'Digital Products', '2–4 Years Experience', 'Salary + Commission', 'Full-Time'],
  NULL, NULL, NULL, NULL, NULL, 2
),
(
  'Sales Executive — US Market', 'india', 2,
  'Gurgaon, Delhi NCR | Work from Office',
  'Night Shift',
  'Sell digital growth solutions — websites, AI tools, local SEO — to small business owners and entrepreneurs in the US. Build your pipeline, manage relationships, and close with direct support from a senior sales mentor who has built and scaled teams from scratch.',
  ARRAY['International Sales', '2–3 Years Experience', 'Strong Spoken English', 'Night Shift (US EST/PST)', 'Salary + Incentive'],
  NULL, NULL, NULL, NULL, NULL, 3
),
(
  'Call Setter — US Market', 'india', 1,
  'Gurgaon, Delhi NCR | Work from Office',
  'Night Shift',
  'You are the first voice a US small business owner hears. Reach out to business owners, introduce what we do, qualify their interest, and book appointments for the sales team. Full training provided. This is not a scripted call-centre role — you will be coached to have real conversations. Clear growth path to Sales Executive within 6–12 months.',
  ARRAY['Outbound Calling', '0–2 Years Experience', 'Freshers Welcome', 'Night Shift', 'Salary + Appointment Incentive'],
  NULL, NULL, NULL, NULL, NULL, 4
),
(
  'SEO Team Lead', 'india', 1,
  'Gurgaon, Delhi NCR | Work from Office / Hybrid',
  'Day Shift',
  'Lead our SEO function for US-based local business clients. You will own keyword strategy, on-page and off-page execution, Google Business Profile optimisation, and monthly reporting. You will also guide and review the work of our SEO interns.',
  ARRAY['3+ Years SEO Experience', 'Local SEO — US Market', 'Google Search Console', 'Ahrefs / SEMrush', 'Team Handling Experience', 'Content Strategy'],
  '⚠ How to Apply — Please Read Before Sending',
  ARRAY[
    'Your responsibilities in your current or last role.',
    'The exact SEO tasks you personally executed.',
    'Live URLs of websites you have actively worked on in the last 12 months — with the specific results achieved. Applications without live URLs will not be reviewed.'
  ],
  'CV is optional.',
  'Send your work profile to: ajay@noveliotech.com',
  'Send Work Profile →', 5
),
(
  'SEO Intern', 'india', 2,
  'Gurgaon, Delhi NCR | Work from Office',
  'Day Shift',
  'Learn SEO by doing real SEO. You will work on live US client websites under the guidance of our SEO Team Lead — keyword research, on-page fixes, GMB updates, content briefs, and rank tracking. If you have touched even one live website and seen results move, we want to hear from you.',
  ARRAY['0–1 Year Experience', 'Basic SEO Knowledge', 'Google Search Console', 'Eager to Learn', 'Stipend + Incentive'],
  '⚠ How to Apply — Please Read Before Sending',
  ARRAY[
    'What you have done in SEO so far — your exact responsibilities.',
    'Tools you have used (e.g. Ahrefs, GSC, SEMrush).',
    'At least one live URL you have worked on and what changed after your work. Even personal projects or college websites count — just show us the work and the result.'
  ],
  'CV is optional.',
  'Send your work profile to: ajay@noveliotech.com',
  'Send Work Profile →', 6
);

COMMENT ON TABLE job_postings     IS 'Open roles shown on noveliotech.com/careers — served via /api/public/careers.';
COMMENT ON TABLE job_applications IS 'Applications submitted from the public careers page.';
