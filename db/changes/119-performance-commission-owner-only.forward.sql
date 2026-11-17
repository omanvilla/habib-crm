-- SQL119 (17 Nov 2026, Ahmed: «نعم، احجبها كلها»). After SQL118 an agent still read office commission figures from the
-- performance reports. They are now for the owner only, NULL for everyone else (a manager already got NULL, and the
-- screens already show a NULL as «محجوبة»):
--   crm_branch_performance        expected_commission, commission_collected, company_commission (was: also the branch's agent)
--   crm_employee_performance      the same three (was: also the agent's own row)
--   crm_employee_target_snapshot  expected_commission, collected_commission (was: also the agent's own row)
-- Not changed: the goal numbers (4,000 / booking_commission_target), sales_goal_met, the counts of deals whose
-- commission is unknown, and every non-money figure. crm_branch_monthly_targets only carries goal numbers.
-- Each live body is read, md5-checked, the guarded condition replaced the exact number of times, and executed.
-- Rollback: 119-performance-commission-owner-only.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $sql119$
DECLARE r record; def text; hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.crm_branch_performance(date,date)', '1452ca804e3bdeef10912e5427db0221', 3,
     $o$case when v_role='owner' or (v_role='agent' and crm_repair_private.staff_is_branch_member(e.company_id,e.id)) then coalesce($o$,
     $n$case when v_role='owner' then coalesce($n$),
    ('public.crm_employee_performance(date,date)', '64d5557aa27b547d612a701f8c4b13ad', 3,
     $o$case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce($o$,
     $n$case when v_role='owner' then coalesce($n$),
    ('public.crm_employee_target_snapshot()', 'e1f1fc931d4105a629fcbc8c3dc1a837', 2,
     $o$CASE WHEN r='owner' OR id=u THEN $o$,
     $n$CASE WHEN r='owner' THEN $n$)
  ) v(fn, live_md5, times, old_part, new_part) LOOP
    def := pg_get_functiondef(r.fn::regprocedure);
    IF md5(def) <> r.live_md5 THEN RAISE EXCEPTION 'SQL119 refused: % changed since 17 Nov 2026, read it again first', r.fn; END IF;
    hits := (length(def) - length(replace(def, r.old_part, ''))) / length(r.old_part);
    IF hits <> r.times THEN RAISE EXCEPTION 'SQL119 refused: % has the commission condition % times, expected %', r.fn, hits, r.times; END IF;
    EXECUTE replace(def, r.old_part, r.new_part);
  END LOOP;
END $sql119$;
