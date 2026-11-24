-- Rollback of SQL156: the four functions get their fragments back, the job and the table go.
-- Notifications that were not written while SQL156 was live are not recreated.
DO $patch$
DECLARE
  r record; v_def text; v_stuck constant text := '(v.viewing_date < v_today - 5 OR coalesce(v.notes, '''') LIKE ''%موقوفة عند أحمد%'')';
  v_matched constant text := '''owner_leads_matched'', (SELECT count(*) FROM public.owner_leads l WHERE l.company_id = v_company AND l.status IN (''open'',''studied'') AND EXISTS (SELECT 1 FROM public.owner_lead_matches m JOIN public.client_requests q ON q.id = m.request_id WHERE m.lead_id = l.id AND q.status = ''active'')),';
  v_stuck_n constant text := '''overdue_stuck'', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN (''scheduled'',''confirmed'',''postponed'') AND v.viewing_date < v_today AND ';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.crm_owner_home()', 'crm_repair_private.cron_last_runs d ON d.jobid = j.jobid', 'cron.job_run_details d ON d.jobid = j.jobid'),
      ('public.crm_owner_home()', v_stuck_n || v_stuck || '), ''overdue'', coalesce(', '''overdue'', coalesce('),
      ('public.crm_owner_home()', ', ' || v_stuck || ' AS stuck', ''),
      ('public.crm_owner_home()', v_matched || ' ''problems'', v_problems,', '''problems'', v_problems,'),
      ('public.crm_staff_home()', v_stuck_n || v_stuck || '), ''overdue'', coalesce(', '''overdue'', coalesce('),
      ('public.crm_staff_home()', ', ' || v_stuck || ' AS stuck', ''),
      ('public.crm_staff_home()', v_matched || ' ''problems'', ''[]''::jsonb,', '''problems'', ''[]''::jsonb,'),
      ('public.crm_match_owner_leads(boolean)', 'if false and p_notify then /* SQL156: the home tile shows the number */', 'if p_notify then'),
      ('crm_repair_private.whatsapp_usage_alert()', 'ELSIF false AND u.used >= 800 THEN /* SQL156: paid replies continue */', 'ELSIF u.used >= 800 THEN')
    ) AS x(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.old IN v_def) = 0 THEN CONTINUE; END IF;
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
END $patch$;
SELECT cron.unschedule('crm_cron_last_runs');
DROP FUNCTION IF EXISTS crm_repair_private.cron_last_runs_refresh();
DROP TABLE IF EXISTS crm_repair_private.cron_last_runs;
