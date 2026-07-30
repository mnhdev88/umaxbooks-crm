-- 097_caller_number_line_labels.sql
-- Name the two inbound lines so the incoming-call popup can tell an agent which
-- business line the caller dialed.
--
-- WHY: both 'full' numbers (093) ring the same people, and until now the popup showed
-- only the caller. An agent picking up had no way to know whether to answer as support
-- for an existing customer or as the Novelio Technologies sales line — so they either
-- guessed or opened with a neutral greeting on every call.
--
-- caller_numbers.label already existed (091) and was NULL on every row, which is what
-- it was for. Reusing it beats a hardcoded number→name map in the webhook: adding an
-- eighth number then means editing a row, not shipping a deploy, and the label lives
-- next to the inbound_mode decision it pairs with.
--
-- Only the two inbound lines are labelled. The five 'deflect' numbers never reach a
-- browser (they speak a redirect and hang up), so a label on them would be dead data.

UPDATE caller_numbers SET label = 'Registered Customers'   WHERE phone_number = '+19086395666';
UPDATE caller_numbers SET label = 'Novelio Technologies'   WHERE phone_number = '+16464378692';

COMMENT ON COLUMN caller_numbers.label IS
  'Human name for the line, shown on the incoming-call popup so the agent knows which business line was dialed. NULL is fine — the popup falls back to the number itself.';
