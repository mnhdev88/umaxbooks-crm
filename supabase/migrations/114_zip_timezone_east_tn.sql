-- East Tennessee ZIP prefixes 373 (Chattanooga area) and 376 (Johnson City,
-- Kingsport) were mapped to Central. They are Eastern. Mirrors lib/zip-timezone.ts.
CREATE OR REPLACE FUNCTION zip_to_timezone(zip text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
  p int;
BEGIN
  IF zip IS NULL THEN RETURN NULL; END IF;
  d := substring(btrim(zip) from '^\d{3,5}');
  IF d IS NULL OR length(d) < 3 THEN RETURN NULL; END IF;
  p := left(d, 3)::int;
  RETURN CASE
    WHEN p BETWEEN 0   AND 5   THEN 'America/New_York'
    WHEN p BETWEEN 6   AND 9   THEN 'America/Puerto_Rico'
    WHEN p BETWEEN 10  AND 319 THEN 'America/New_York'
    WHEN p BETWEEN 320 AND 323 THEN 'America/New_York'
    WHEN p BETWEEN 324 AND 325 THEN 'America/Chicago'
    WHEN p BETWEEN 326 AND 349 THEN 'America/New_York'
    WHEN p BETWEEN 350 AND 369 THEN 'America/Chicago'
    WHEN p BETWEEN 370 AND 372 THEN 'America/Chicago'
    WHEN p BETWEEN 373 AND 374 THEN 'America/New_York'
    WHEN p = 375               THEN 'America/Chicago'
    WHEN p BETWEEN 376 AND 379 THEN 'America/New_York'
    WHEN p BETWEEN 380 AND 385 THEN 'America/Chicago'
    WHEN p BETWEEN 386 AND 397 THEN 'America/Chicago'
    WHEN p BETWEEN 398 AND 399 THEN 'America/New_York'
    WHEN p BETWEEN 400 AND 419 THEN 'America/New_York'
    WHEN p BETWEEN 420 AND 421 THEN 'America/Chicago'
    WHEN p BETWEEN 422 AND 427 THEN 'America/New_York'
    WHEN p BETWEEN 430 AND 458 THEN 'America/New_York'
    WHEN p BETWEEN 459 AND 462 THEN 'America/New_York'
    WHEN p BETWEEN 463 AND 464 THEN 'America/Chicago'
    WHEN p BETWEEN 465 AND 475 THEN 'America/New_York'
    WHEN p BETWEEN 476 AND 477 THEN 'America/Chicago'
    WHEN p BETWEEN 478 AND 498 THEN 'America/New_York'
    WHEN p = 499               THEN 'America/Chicago'
    WHEN p BETWEEN 500 AND 528 THEN 'America/Chicago'
    WHEN p BETWEEN 530 AND 549 THEN 'America/Chicago'
    WHEN p BETWEEN 550 AND 567 THEN 'America/Chicago'
    WHEN p BETWEEN 570 AND 575 THEN 'America/Chicago'
    WHEN p BETWEEN 576 AND 577 THEN 'America/Denver'
    WHEN p BETWEEN 580 AND 586 THEN 'America/Chicago'
    WHEN p BETWEEN 587 AND 588 THEN 'America/Denver'
    WHEN p BETWEEN 590 AND 599 THEN 'America/Denver'
    WHEN p BETWEEN 600 AND 629 THEN 'America/Chicago'
    WHEN p BETWEEN 630 AND 658 THEN 'America/Chicago'
    WHEN p BETWEEN 660 AND 679 THEN 'America/Chicago'
    WHEN p BETWEEN 680 AND 689 THEN 'America/Chicago'
    WHEN p BETWEEN 690 AND 693 THEN 'America/Denver'
    WHEN p BETWEEN 700 AND 714 THEN 'America/Chicago'
    WHEN p BETWEEN 716 AND 729 THEN 'America/Chicago'
    WHEN p BETWEEN 730 AND 749 THEN 'America/Chicago'
    WHEN p BETWEEN 750 AND 797 THEN 'America/Chicago'
    WHEN p BETWEEN 798 AND 799 THEN 'America/Denver'
    WHEN p BETWEEN 800 AND 816 THEN 'America/Denver'
    WHEN p BETWEEN 820 AND 831 THEN 'America/Denver'
    WHEN p BETWEEN 832 AND 837 THEN 'America/Denver'
    WHEN p = 838               THEN 'America/Los_Angeles'
    WHEN p BETWEEN 840 AND 847 THEN 'America/Denver'
    WHEN p BETWEEN 850 AND 864 THEN 'America/Phoenix'
    WHEN p BETWEEN 870 AND 884 THEN 'America/Denver'
    WHEN p BETWEEN 889 AND 898 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 900 AND 961 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 967 AND 968 THEN 'Pacific/Honolulu'
    WHEN p = 969               THEN 'Pacific/Guam'
    WHEN p BETWEEN 970 AND 979 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 980 AND 994 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 995 AND 999 THEN 'America/Anchorage'
    ELSE NULL
  END;
END;
$$;

-- leads.timezone is a stored generated column, so existing rows keep the old value
-- until they are rewritten.
UPDATE leads
SET zip_code = zip_code
WHERE substring(btrim(zip_code) from '^\d{3}') IN ('373', '376');
