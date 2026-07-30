-- 100_caller_number_inbound_all.sql
-- Put every pool number on live inbound, and make inbound_mode editable from Settings.
--
-- WHY: 093 defaulted new numbers to 'deflect' so a cold-call number wouldn't ring the
-- whole team on a callback, and only promoted the two established lines. In practice
-- that means a lead who returns a call from any of the other five hears a recorded
-- redirect and has to dial again — most don't. A returned cold call is the warmest
-- inbound the dialer produces, so deflecting it is the wrong trade: the hunt group
-- ringing more often is cheaper than losing those callbacks.
--
-- 093's reasoning still holds for the *default*: a number added later is an unknown
-- until someone decides otherwise, so the column default stays 'deflect'. This
-- migration only promotes the seven numbers that exist today.
--
-- NOTE: the DB value alone does not route anything. Twilio holds the Voice URL per
-- number, so after applying this run:
--     node scripts/set-twilio-voice-webhooks.mjs --run
-- until then Twilio still points the five at /api/voice/twilio/deflect.

UPDATE caller_numbers
   SET inbound_mode = 'full'
 WHERE is_active
   AND inbound_mode <> 'full';

-- 093's comment described 'deflect' as the resting state for outbound-only numbers.
-- It is still the default for a new row, but it is now an exception rather than the
-- norm, so say so where the next person will read it.
COMMENT ON COLUMN caller_numbers.inbound_mode IS
  'What a callback to this number does. full = ring owner then hunt group then voicemail (092) — the norm, so returned cold calls reach a person. deflect = play a spoken redirect to the main line and hang up, for a number that should never ring the team. Editable in Settings → Caller Numbers. Applied to Twilio by scripts/set-twilio-voice-webhooks.mjs — changing this column alone does not re-route calls.';
