-- 076_lead_alt_contacts.sql
-- Multiple emails / phone numbers per lead.
--
-- leads.email / leads.phone stay the *primary* contact fields (everything that
-- reads a single value — dialer default, compose default, contracts, template
-- placeholders, CSV exports — keeps working untouched). Extra addresses and
-- numbers live in two jsonb arrays of { "value": "...", "label": "Work" }
-- entries, edited from the Add/Edit Lead form's "+ Add email / phone" rows and
-- offered as alternatives in the dialer pre-call popup and the email compose
-- "To" picker. Duplicate detection on new leads also matches against these.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS alt_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS alt_phones JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN leads.alt_emails IS 'Additional email addresses: [{"value":"a@b.com","label":"Work"}]; leads.email remains the primary.';
COMMENT ON COLUMN leads.alt_phones IS 'Additional phone numbers: [{"value":"+1555...","label":"Office"}]; leads.phone remains the primary.';
