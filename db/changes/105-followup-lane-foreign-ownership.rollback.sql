-- Rollback of SQL105: followup_lane goes back to the SQL91 word list (a question about ownership for a foreigner is in the
-- «مسقط» lane again unless something else marks the client as an investor).
SET LOCAL lock_timeout = '10s';

DO $mig$
DECLARE
  v_def text := pg_get_functiondef('crm_repair_private.followup_lane(uuid, uuid, text, text)'::regprocedure);
  c_old constant text := 'تملك حر|التملك الحر|';
  c_new constant text := 'تملك حر|التملك الحر|تملك\s*(ال|لل|ل)?[أا]جا?نب|لل[أا]جانب|غير العماني|';
BEGIN
  IF position(c_new IN v_def) > 0 THEN EXECUTE replace(v_def, c_new, c_old); END IF;
END $mig$;
