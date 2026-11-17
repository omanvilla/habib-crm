-- Rollback of SQL119: the branch's agent / the agent's own row read the office commission figures again.
-- Refused when a function no longer has the SQL119 condition the exact number of times (it would touch other lines).
SET LOCAL lock_timeout = '10s';

DO $sql119rb$
DECLARE r record; def text; hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.crm_branch_performance(date,date)', 3,
     $o$case when v_role='owner' or (v_role='agent' and crm_repair_private.staff_is_branch_member(e.company_id,e.id)) then coalesce($o$,
     $n$case when v_role='owner' then coalesce($n$),
    ('public.crm_employee_performance(date,date)', 3,
     $o$case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce($o$,
     $n$case when v_role='owner' then coalesce($n$),
    ('public.crm_employee_target_snapshot()', 2,
     $o$CASE WHEN r='owner' OR id=u THEN $o$,
     $n$CASE WHEN r='owner' THEN $n$)
  ) v(fn, times, old_part, new_part) LOOP
    def := pg_get_functiondef(r.fn::regprocedure);
    hits := (length(def) - length(replace(def, r.new_part, ''))) / length(r.new_part);
    IF hits <> r.times THEN RAISE EXCEPTION 'SQL119 rollback refused: % has the owner-only condition % times, expected %', r.fn, hits, r.times; END IF;
    EXECUTE replace(def, r.new_part, r.old_part);
  END LOOP;
END $sql119rb$;
