-- 108_caller_number_auto_rotate.sql
-- Split "offer this number in the Call from dropdown" from "spend this number
-- automatically", which is_active has been conflating.
--
-- WHY: 107 put +13234171367 and +18139931657 back so agents could pick them
-- deliberately, but is_active is the only flag the dialer has and it drives both
-- consumers — the dropdown (app/api/dialer/caller-options) AND the automatic ranking
-- (lib/voice/caller-numbers.ts). Reactivating them therefore also handed them back to
-- the rotation, which is what 106 retired them from. These two are the numbers that
-- picked up the carrier "Spam Likely" reputation, so they should carry only the volume
-- an agent chooses to put on them, never volume the picker assigns.
--
-- auto_rotate defaults TRUE so every existing row and every number added through
-- Settings keeps today's behaviour; only a deliberate opt-out changes anything.
--
-- The three states this gives a number:
--   is_active=F                  → gone from the dropdown, never auto-picked. ("Rested")
--   is_active=T, auto_rotate=F   → pickable by hand, never auto-picked. ("Manual only")
--   is_active=T, auto_rotate=T   → pickable by hand and in the rotation. ("In rotation")
-- Inbound routing is independent of both (093/100) and lives in Twilio's per-number
-- Voice URL, so nothing here changes what a callback does.

ALTER TABLE caller_numbers
  ADD COLUMN IF NOT EXISTS auto_rotate BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN caller_numbers.auto_rotate IS
  'Whether the automatic picker may spend this number. FALSE keeps it in the agent''s "Call from" dropdown for deliberate use but excludes it from the rotation — for numbers with a damaged carrier reputation, or a line reserved for a specific purpose. Requires is_active; see is_active for removing a number from the dropdown entirely.';

-- The two restored in 107: manual use only.
UPDATE caller_numbers
   SET auto_rotate = FALSE,
       notes = coalesce(notes || ' · ', '') || 'Manual-only 2026-09-01 (migration 108): selectable in the dropdown, excluded from auto rotation.'
 WHERE phone_number IN ('+13234171367', '+18139931657');
