-- SQL111 (17 Nov 2026, Ahmed: «صلّح عنوان مهام مجدولة فشلت اليوم»). The «مشاكل» tile of the home counted every failed run of the last
-- 24 hours: on 17 Nov it said «مهام مجدولة فشلت اليوم 12» for one startup timeout at 09:30 on 16 Nov, after which every job ran fine.
-- It now counts the active jobs whose LAST run (within 8 days, so weekly jobs are seen) failed, i.e. still broken now, under the title
-- «مهام مجدولة متعطلة الحين». A job that failed once and then ran again leaves the list by itself.
-- Only that statement of crm_owner_home() changes: the live body is read, md5-checked, the one statement replaced and executed.
-- Rollback: 111-jobs-broken-now.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $sql111$
DECLARE def text := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  old_part text := $o$  SELECT count(*), string_agg(DISTINCT j.jobname, ' · ') INTO v_n, v_text FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.active AND d.status = 'failed' AND d.start_time > now() - interval '24 hours';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'مهام مجدولة فشلت اليوم', 'count', v_n, 'detail', v_text); END IF;$o$;
  new_part text := $n$  SELECT count(*), string_agg(x.jobname, ' · ' ORDER BY x.jobname) INTO v_n, v_text FROM (
    SELECT DISTINCT ON (j.jobid) j.jobname, d.status FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid
     WHERE j.active AND d.start_time > now() - interval '8 days' ORDER BY j.jobid, d.start_time DESC) x
   WHERE x.status = 'failed';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'مهام مجدولة متعطلة الحين', 'count', v_n, 'detail', v_text); END IF;$n$;
BEGIN
  IF md5(def) <> 'b7fb01abebacab144c1f4d99074ac0c9' THEN
    RAISE EXCEPTION 'SQL111 refused: crm_owner_home changed since 17 Nov 2026, read it again first';
  END IF;
  IF position(old_part IN def) = 0 THEN RAISE EXCEPTION 'SQL111 refused: the failed-jobs statement is not where expected'; END IF;
  EXECUTE replace(def, old_part, new_part);
END $sql111$;
