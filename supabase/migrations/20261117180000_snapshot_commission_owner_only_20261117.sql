-- SQL118 (17 Nov 2026, Ahmed: «احجب العمولة عن الموظف»). crm_branch_target_snapshot() gave an agent of a branch that
-- branch's expected and collected office commission, and the old target card behind «قائمة العمل الكاملة» showed it,
-- while the goals card on the home hides money from staff. Both figures are now for the owner only; for everyone else
-- they are NULL, which the old card already shows as «عمولات المكتب المتوقعة محجوبة لهذا الدور».
-- Not changed: the commission goal number (4,000) and sales_goal_met stay in the answer, and the branch / employee
-- performance reports still carry commission for the branch's own agent (Ahmed's to decide, see docs/current-state.md).
-- Only that line of the function changes: the live body is read, md5-checked, the one line replaced and executed.
-- Rollback: 118-snapshot-commission-owner-only.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $sql118$
DECLARE def text := pg_get_functiondef('public.crm_branch_target_snapshot()'::regprocedure);
  old_part text := $o$  'expected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_is_branch_member(c,branch)) THEN expected_commission END,'collected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_is_branch_member(c,branch)) THEN collected_commission END,$o$;
  new_part text := $n$  'expected_commission',CASE WHEN r='owner' THEN expected_commission END,'collected_commission',CASE WHEN r='owner' THEN collected_commission END,$n$;
BEGIN
  IF md5(def) <> 'e696ada8c3a429f8d250a1fe246696c4' THEN
    RAISE EXCEPTION 'SQL118 refused: crm_branch_target_snapshot changed since 17 Nov 2026, read it again first';
  END IF;
  IF position(old_part IN def) = 0 THEN RAISE EXCEPTION 'SQL118 refused: the commission line is not where expected'; END IF;
  EXECUTE replace(def, old_part, new_part);
END $sql118$;
