-- 112_client_portal_email_identifier.sql
--
-- Let a client open the front door with EITHER their phone number or their
-- email address.
--
-- 111 keyed an access code to phone_digits because the front door only asked
-- for a phone number. In practice a client remembers whichever one they gave
-- us — often the email, since that is where our proposals arrive — and being
-- turned away for typing the "wrong" correct detail is a support call.
--
-- Two changes:
--
--   * phone_digits becomes optional and `identifier` records what was actually
--     typed (normalised: last 10 digits, or a lowercased email). It is what the
--     rate limiter counts, so requesting by email and by phone can't be used to
--     double the allowance.
--
--   * lead_id_for_email() mirrors lead_id_for_phone() from 092 — same
--     SECURITY DEFINER shape, same service_role-only grant, same "most recently
--     touched lead wins" tie-break — and searches alt_emails (076) as well as
--     the primary address.
--
-- The CHECK on phone_digits is left alone: a CHECK passes on NULL, so an
-- email-only request satisfies it without loosening the rule for rows that do
-- carry a number.

ALTER TABLE share_access_codes
  ALTER COLUMN phone_digits DROP NOT NULL;

ALTER TABLE share_access_codes
  ADD COLUMN IF NOT EXISTS identifier TEXT;

CREATE INDEX IF NOT EXISTS share_access_codes_identifier_idx
  ON share_access_codes(identifier, created_at DESC);

COMMENT ON COLUMN share_access_codes.identifier   IS 'What the client typed, normalised: last 10 digits of a phone, or a lowercased email. The rate-limit key.';
COMMENT ON COLUMN share_access_codes.phone_digits IS 'Last 10 digits when the client identified by phone; NULL when they used an email.';

-- Emails vary in case and sit in two places (leads.email and the alt_emails
-- array added in 076), so a plain equality match on one column misses. Mirrors
-- lead_id_for_phone(): returns an id and never lead data, SECURITY DEFINER
-- because the caller is an unauthenticated visitor at the front door with no
-- session to satisfy the leads RLS policies, and locked to service_role.
CREATE OR REPLACE FUNCTION lead_id_for_email(p_email TEXT)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT lower(btrim(p_email)) AS e
  )
  SELECT l.id
  FROM leads l, target t
  WHERE t.e <> ''
    AND position('@' in t.e) > 1
    AND (
      lower(btrim(coalesce(l.email, ''))) = t.e
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(l.alt_emails) = 'array' THEN l.alt_emails ELSE '[]'::jsonb END
             ) AS alt(v)
        -- alt_emails rows are {value,label} objects (076); ->> 'value' reads the
        -- address itself rather than the JSON text of the whole object.
        WHERE lower(btrim(coalesce(alt.v ->> 'value', ''))) = t.e
      )
    )
  ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
  LIMIT 1
$$;

COMMENT ON FUNCTION lead_id_for_email(TEXT) IS 'Resolve an email address to a lead id, matching leads.email and alt_emails case-insensitively. Used by the unauthenticated client front door.';

REVOKE EXECUTE ON FUNCTION lead_id_for_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lead_id_for_email(TEXT) TO service_role;
