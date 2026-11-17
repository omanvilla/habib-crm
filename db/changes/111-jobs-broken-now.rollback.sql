-- Rollback of SQL111: the failed-jobs statement of crm_owner_home() counts every failed run of the last 24 hours again.
SET LOCAL lock_timeout = '10s';

DO $sql111rb$
DECLARE def text := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  new_part text := $n$  SELECT count(*), string_agg(x.jobname, ' · ' ORDER BY x.jobname) INTO v_n, v_text FROM (
    SELECT DISTINCT ON (j.jobid) j.jobname, d.status FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid
     WHERE j.active AND d.start_time > now() - interval '8 days' ORDER BY j.jobid, d.start_time DESC) x
   WHERE x.status = 'failed';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'مهام مجدولة متعطلة الحين', 'count', v_n, 'detail', v_text); END IF;$n$;
  old_part text := $o$  SELECT count(*), string_agg(DISTINCT j.jobname, ' · ') INTO v_n, v_text FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.active AND d.status = 'failed' AND d.start_time > now() - interval '24 hours';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'مهام مجدولة فشلت اليوم', 'count', v_n, 'detail', v_text); END IF;$o$;
BEGIN
  IF position(new_part IN def) = 0 THEN RAISE EXCEPTION 'SQL111 rollback refused: the SQL111 statement is not in crm_owner_home'; END IF;
  EXECUTE replace(def, new_part, old_part);
END $sql111rb$;
