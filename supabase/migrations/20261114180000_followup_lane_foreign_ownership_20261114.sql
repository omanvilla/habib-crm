-- SQL105 (14 Nov 2026, R65; note a4f6f4dc on the Muscat follow-ups list): a client who asks about ownership for a foreigner
-- («تملك الأجنبي», «تملك لاجنبي», «للأجانب», «غير العماني») is an investor and belongs to the «المستثمرين» lane of the daily
-- follow-ups, not to «مسقط». SQL91 knew «تملك حر» and «التملك الحر» only. Nothing else in followup_lane changes: the three
-- words are added to its list. Rollback: 105-followup-lane-foreign-ownership.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $mig$
DECLARE
  v_def text := pg_get_functiondef('crm_repair_private.followup_lane(uuid, uuid, text, text)'::regprocedure);
  c_old constant text := 'تملك حر|التملك الحر|';
  c_new constant text := 'تملك حر|التملك الحر|تملك\s*(ال|لل|ل)?[أا]جا?نب|لل[أا]جانب|غير العماني|';
BEGIN
  IF md5(v_def) <> '71de97d313d9c8dd21efe767a7a78d12' THEN
    RAISE EXCEPTION 'SQL105 refused: followup_lane changed since SQL91';
  END IF;
  IF position(c_old IN v_def) = 0 THEN RAISE EXCEPTION 'SQL105 refused: the word list was not found'; END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $mig$;
