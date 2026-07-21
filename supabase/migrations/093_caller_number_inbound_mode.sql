-- 093_caller_number_inbound_mode.sql
-- Per-number inbound behaviour, so the pool can grow without every new number
-- pulling the whole team's phones into its callbacks.
--
-- WHY: 091 gave us a rotating outbound pool and 092 gave every number the full
-- inbound treatment (ring the owning agent → hunt group → voicemail). That pairing
-- doesn't hold once the pool has seven numbers: the team wants live callbacks on the
-- two established lines only, and the outbound-only numbers should deflect rather
-- than ring seven ways.
--
-- The alternative was hardcoding the two "real" numbers in the webhook script, which
-- silently does the wrong thing for number eight. This keeps the decision next to the
-- number it describes, and scripts/set-twilio-voice-webhooks.mjs reads it to pick
-- each number's Voice URL.
--
-- 'full'    → /api/voice/twilio/incoming  (092 routing: owner, hunt group, voicemail)
-- 'deflect' → /api/voice/twilio/deflect   (spoken redirect to the main line, hang up)
--
-- Default is 'deflect': a number added to the pool is an outbound cold-call number
-- until someone deliberately promotes it. Getting that backwards rings everyone.

ALTER TABLE caller_numbers
  ADD COLUMN IF NOT EXISTS inbound_mode TEXT NOT NULL DEFAULT 'deflect';

ALTER TABLE caller_numbers
  DROP CONSTRAINT IF EXISTS caller_numbers_inbound_mode_check;

ALTER TABLE caller_numbers
  ADD CONSTRAINT caller_numbers_inbound_mode_check
  CHECK (inbound_mode IN ('full', 'deflect'));

COMMENT ON COLUMN caller_numbers.inbound_mode IS
  'What a callback to this number does. full = ring owner then hunt group then voicemail (092). deflect = play a spoken redirect to the main line and hang up. Applied to Twilio by scripts/set-twilio-voice-webhooks.mjs.';

-- The two established lines keep live inbound; everything else deflects. Written as
-- an explicit list rather than "the oldest two" so a re-run can't drift.
UPDATE caller_numbers
   SET inbound_mode = 'full'
 WHERE phone_number IN ('+19086395666', '+16464378692');
