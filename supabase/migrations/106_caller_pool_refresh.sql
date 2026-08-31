-- 106_caller_pool_refresh.sql
-- Retire the three original caller IDs from outbound rotation and stand up a fresh
-- pool of eight registered numbers.
--
-- WHY: 091 spread cold-call volume across a pool to keep any one number under the
-- carrier analytics thresholds that produce a "Spam Likely" label. The pool has since
-- shrunk to three numbers carrying the full ~170 calls/day between them, which is the
-- concentration 091 existed to avoid. These eight replace them: all eight are already
-- owned in the Twilio account and have been through Trust Hub (Attestation A + CNAM)
-- and freecallerregistry.com, so they go in with registered = TRUE and the picker
-- (lib/voice/caller-numbers.ts) is free to spend them first.
--
-- The three originals are deactivated, not deleted:
--   +19086395666 — "Registered Customers", the labelled support line. Keeps ringing
--                  through on inbound; is_active = FALSE only removes it from the
--                  outbound rotation and the agent's "Call from" list.
--   +13234171367
--   +18139931657 — same treatment: inbound stays live, outbound moves to the new pool.
-- Inbound routing lives in Twilio's per-number Voice URL, not in this column, so
-- deactivating here cannot break a callback. Rows stay so voice_calls.from_number on
-- historical calls still resolves to a labelled number.
--
-- daily_cap 40 matches the surviving convention (091 documents ~50 as the ceiling for
-- cold outbound); eight numbers at 40 is 320 calls/day of headroom against ~170 used.
--
-- inbound_mode 'full' on all eight, following 100's reasoning: a returned cold call is
-- the warmest inbound the dialer produces, so it should ring the owning agent → hunt
-- group → voicemail rather than hear a deflect message. The column default is still
-- 'deflect', so this is stated per row.
--
-- NOTE: the DB value alone routes nothing. Twilio holds the Voice URL per number, and
-- all eight are currently unset (a callback reaches nothing). After applying, run:
--     node scripts/set-twilio-voice-webhooks.mjs --run

INSERT INTO caller_numbers (phone_number, label, daily_cap, is_active, registered, inbound_mode, notes)
VALUES
  ('+16507609521', 'Novelio Technologies · 650', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+15343447867', 'Novelio Technologies · 534', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+16572206978', 'Novelio Technologies · 657', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+14175386097', 'Novelio Technologies · 417', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+19124175339', 'Novelio Technologies · 912', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+14053550626', 'Novelio Technologies · 405', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+18656749166', 'Novelio Technologies · 865', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered'),
  ('+17403064890', 'Novelio Technologies · 740', 40, TRUE, TRUE, 'full', 'Added to pool 2026-09-01; Trust Hub + CNAM registered')
ON CONFLICT (phone_number) DO UPDATE
  SET label        = EXCLUDED.label,
      daily_cap    = EXCLUDED.daily_cap,
      is_active    = TRUE,
      registered   = TRUE,
      inbound_mode = 'full';

UPDATE caller_numbers
   SET is_active = FALSE,
       notes = coalesce(notes || ' · ', '') || 'Retired from outbound rotation 2026-09-01 (migration 106); inbound unchanged.'
 WHERE phone_number IN ('+19086395666', '+13234171367', '+18139931657');
