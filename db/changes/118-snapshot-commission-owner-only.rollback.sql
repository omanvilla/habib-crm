-- Rollback of SQL118: an agent of a branch reads that branch's expected and collected office commission again.
SET LOCAL lock_timeout = '10s';

DO $sql118rb$
DECLARE def text := pg_get_functiondef('public.crm_branch_target_snapshot()'::regprocedure);
  old_part text := $o$  'expected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_is_branch_member(c,branch)) THEN expected_commission END,'collected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_is_branch_member(c,branch)) THEN collected_commission END,$o$;
  new_part text := $n$  'expected_commission',CASE WHEN r='owner' THEN expected_commission END,'collected_commission',CASE WHEN r='owner' THEN collected_commission END,$n$;
BEGIN
  IF position(new_part IN def) = 0 THEN RAISE EXCEPTION 'SQL118 rollback refused: the SQL118 line is not in crm_branch_target_snapshot'; END IF;
  EXECUTE replace(def, new_part, old_part);
END $sql118rb$;
