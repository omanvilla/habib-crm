-- SQL156 (24 Nov 2026, full system check; Ahmed: «إيوا ابدأ» on the first three improvements).
--
-- 1. Quieter alerts.
--    * crm_match_owner_leads wrote one notification per owner offer with ready buyers on every run: 158 unread on the owner's
--      bell, burying the ones that need him. It no longer writes them; the home returns owner_leads_matched (open or studied
--      offers that have a matched buyer whose request is still active) and the «عروض ملاك» tile shows that number.
--    * whatsapp_usage_alert no longer warns at 800 of the 1,000 free replies: both numbers passed 1,000 in November and the
--      replies kept going (a payment method is on the Meta account). The «ردود النظام واقفة» alert (last five replies not
--      delivered) stays, it is the one that means something.
--    * instagram_discovery notifications are NOT touched: decision 55 of 18 Nov sends them to Ahmed's WhatsApp.
-- 2. Faster home. crm_owner_home read cron.job_run_details (44,000 rows, no index we may add: the table belongs to
--    supabase_admin) on every open to find a failed job: 1.5 s of the 2.9 s when the cache is cold. It now reads
--    crm_repair_private.cron_last_runs, one row per job, kept by a job every 5 minutes that only looks at the newest runs.
-- 3. Overdue visits nobody will close. A visit whose chat Ahmed or the office holds («[موقوفة عند أحمد]» in the notes) is never
--    asked about by the agent, so it stayed «مجدولة» for ever (4 of them from 14 to 16 Nov). Both homes now mark a row
--    stuck (held chat, or more than 5 days past its date) and return overdue_stuck; the tile turns urgent for them.
-- The functions are patched in place (their text is long and SQL134 to SQL155 changed it): every fragment must be found, or
-- the block stops and nothing changes. Running it twice changes nothing.
-- Rollback: 156-home-speed-quiet-alerts.rollback.sql

CREATE TABLE IF NOT EXISTS crm_repair_private.cron_last_runs (
  jobid bigint PRIMARY KEY,
  runid bigint NOT NULL,
  status text,
  start_time timestamptz
);
ALTER TABLE crm_repair_private.cron_last_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.cron_last_runs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.cron_last_runs_refresh()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_from bigint; n integer;
BEGIN
  -- only the newest runs (primary key range): 3,000 back covers every run still «running» when we last looked
  SELECT coalesce(max(runid), 0) - 3000 INTO v_from FROM crm_repair_private.cron_last_runs;
  INSERT INTO crm_repair_private.cron_last_runs AS t (jobid, runid, status, start_time)
  SELECT DISTINCT ON (d.jobid) d.jobid, d.runid, d.status, d.start_time
    FROM cron.job_run_details d
   WHERE d.runid > v_from AND d.start_time IS NOT NULL
   ORDER BY d.jobid, d.start_time DESC
  ON CONFLICT (jobid) DO UPDATE SET runid = EXCLUDED.runid, status = EXCLUDED.status, start_time = EXCLUDED.start_time
   WHERE EXCLUDED.start_time >= t.start_time;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM crm_repair_private.cron_last_runs t WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = t.jobid);
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.cron_last_runs_refresh() FROM PUBLIC, anon, authenticated;

-- first fill: every job's latest run (the one full read)
INSERT INTO crm_repair_private.cron_last_runs (jobid, runid, status, start_time)
SELECT DISTINCT ON (d.jobid) d.jobid, d.runid, d.status, d.start_time
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE d.start_time IS NOT NULL
 ORDER BY d.jobid, d.start_time DESC
ON CONFLICT (jobid) DO UPDATE SET runid = EXCLUDED.runid, status = EXCLUDED.status, start_time = EXCLUDED.start_time;

SELECT cron.schedule('crm_cron_last_runs', '1-56/5 * * * *', $c$ select crm_repair_private.cron_last_runs_refresh(); $c$);

DO $patch$
DECLARE
  r record; v_def text; v_stuck constant text := '(v.viewing_date < v_today - 5 OR coalesce(v.notes, '''') LIKE ''%موقوفة عند أحمد%'')';
  v_matched constant text := '''owner_leads_matched'', (SELECT count(*) FROM public.owner_leads l WHERE l.company_id = v_company AND l.status IN (''open'',''studied'') AND EXISTS (SELECT 1 FROM public.owner_lead_matches m JOIN public.client_requests q ON q.id = m.request_id WHERE m.lead_id = l.id AND q.status = ''active'')),';
  v_stuck_n constant text := '''overdue_stuck'', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN (''scheduled'',''confirmed'',''postponed'') AND v.viewing_date < v_today AND ';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- the home reads one row per job instead of every run
      ('public.crm_owner_home()', 'cron.job_run_details d ON d.jobid = j.jobid', 'crm_repair_private.cron_last_runs d ON d.jobid = j.jobid'),
      ('public.crm_owner_home()', 'SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property',
                                  'SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property, ' || v_stuck || ' AS stuck'),
      ('public.crm_owner_home()', '''overdue'', coalesce(', v_stuck_n || v_stuck || '), ''overdue'', coalesce('),
      ('public.crm_owner_home()', '''problems'', v_problems,', v_matched || ' ''problems'', v_problems,'),
      ('public.crm_staff_home()', 'SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property',
                                  'SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property, ' || v_stuck || ' AS stuck'),
      ('public.crm_staff_home()', '''overdue'', coalesce(', v_stuck_n || v_stuck || '), ''overdue'', coalesce('),
      ('public.crm_staff_home()', '''problems'', ''[]''::jsonb,', v_matched || ' ''problems'', ''[]''::jsonb,'),
      -- no notification per matched offer any more (the number is on the home tile)
      ('public.crm_match_owner_leads(boolean)', 'if p_notify then', 'if false and p_notify then /* SQL156: the home tile shows the number */'),
      -- no «قرّب يخلص» warning at 800
      ('crm_repair_private.whatsapp_usage_alert()', 'ELSIF u.used >= 800 THEN', 'ELSIF false AND u.used >= 800 THEN /* SQL156: paid replies continue */')
    ) AS x(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.new IN v_def) > 0 THEN CONTINUE; END IF;            -- already patched
    IF position(r.old IN v_def) = 0 THEN RAISE EXCEPTION 'SQL156: fragment not found in %: %', r.fn, left(r.old, 60); END IF;
    IF length(v_def) - length(replace(v_def, r.old, '')) <> length(r.old) THEN RAISE EXCEPTION 'SQL156: fragment not unique in %: %', r.fn, left(r.old, 60); END IF;
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
END $patch$;
