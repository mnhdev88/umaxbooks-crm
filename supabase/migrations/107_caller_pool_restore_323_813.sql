-- 107_caller_pool_restore_323_813.sql
-- Put +13234171367 and +18139931657 back into the outbound rotation.
--
-- WHY: 106 retired all three originals when the fresh pool of eight landed. Two of
-- them are wanted back in the agent's "Call from" list, so they go back to
-- is_active = TRUE. They were already registered = TRUE (CNAM confirmed 2026-07-21)
-- and inbound_mode = 'full', so nothing else about them changes — 106 only ever
-- flipped is_active.
--
-- The third original, +19086395666 ("Registered Customers"), stays retired: it is the
-- labelled support line and is deliberately kept off cold outbound.
--
-- Labels are set to match the pool convention from 106, because the dialer's picker
-- renders "<label> · <number> · n/40 today" and a NULL label leaves the row looking
-- unlike its eight neighbours. daily_cap is already 40 on both rows.
--
-- Pool is now ten numbers at 40/day = 400 calls/day of headroom against ~170 used, so
-- the per-number concentration 091 exists to avoid stays comfortably clear.

UPDATE caller_numbers
   SET is_active = TRUE,
       label = 'Novelio Technologies · 323',
       notes = coalesce(notes || ' · ', '') || 'Restored to outbound rotation 2026-09-01 (migration 107).'
 WHERE phone_number = '+13234171367';

UPDATE caller_numbers
   SET is_active = TRUE,
       label = 'Novelio Technologies · 813',
       notes = coalesce(notes || ' · ', '') || 'Restored to outbound rotation 2026-09-01 (migration 107).'
 WHERE phone_number = '+18139931657';
