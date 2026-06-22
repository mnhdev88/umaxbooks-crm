-- Careers: add 'freelance' as a third region.
--
-- The website (noveliotech.com/careers) renders three region groups — US, India,
-- and "Freelance & Project-Based Roles" — but the CRM only ever knew 'us'/'india'
-- (migration 057). So freelance roles could never be created here, and the site's
-- freelance section always fell back to its hardcoded array. This migration opens
-- the third region across the stack and seeds the one freelance role that was
-- hardcoded on the site, so it becomes CRM-managed like the rest.

-- 1. Widen the region constraint to include 'freelance'.
ALTER TABLE job_postings DROP CONSTRAINT IF EXISTS job_postings_region_check;
ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_region_check CHECK (region IN ('us', 'india', 'freelance'));

-- 2. Seed the Video & Image Creator role that was hardcoded on the website.
--    Guarded so re-running (or running after someone added it via the UI) is a no-op.
INSERT INTO job_postings (title, region, openings, job_location, shift, description, pills, apply_note_title, apply_note_points, apply_note_footer, footer_note, btn_label, sort_order)
SELECT
  'Video & Image Creator', 'freelance', 1,
  'Remote / Hybrid | Project-wise / Part-time Association',
  NULL,
  'Turn our products and services into clean, professional, easy-to-understand content. You will create short reels, explainer videos, product demos, and social creatives for our CRM, websites, apps, and AI tools — content that looks polished but stays simple enough for any small business owner to get. You will work with the content and business team to shape the message, and you are encouraged to suggest ideas, not just execute them.',
  ARRAY['Video Editing', 'Reels & Shorts', 'Canva / Photoshop / Illustrator', 'CapCut / Premiere Pro / DaVinci', 'Basic Motion Graphics', 'Thumbnail Design', 'AI Video & Image Tools'],
  '⚠ How to Apply — Please Share With Your Application',
  ARRAY[
    'Your portfolio / sample work — reels, explainer videos, or product demos.',
    'Social media creatives you have already made (posts, carousels, thumbnails, banners).',
    'The tools you use (e.g. Premiere Pro, CapCut, DaVinci, Canva, Photoshop, AI video/image tools).'
  ],
  'A CV is optional — your work samples matter most. Experience creating content for software, SaaS, CRM, or digital-marketing brands is a plus.',
  'Send your portfolio to: ajay@noveliotech.com',
  'Send Portfolio →', 7
WHERE NOT EXISTS (
  SELECT 1 FROM job_postings WHERE title = 'Video & Image Creator' AND region = 'freelance'
);
