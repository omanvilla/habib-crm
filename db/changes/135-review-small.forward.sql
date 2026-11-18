-- SQL135 (18 Nov 2026, Ahmed's decision review, docs/مراجعة-القرارات-20261118.md, approved «نعم موافق»).
--  [56] no fixed pricing day: the new-land WhatsApp alert said «ليوم التسعير (الأربعاء)» (SQL109); it now says the study runs today.
--  [35] the daily staff task «جهّز زيارات بكره <date> · …» (added by the 1pm «زيارات بكره» routine) closes by itself on the
--       visit day, with the note «انقفلت لحالها». No such task was open when this was applied (nothing existing was closed).
--  [63] the Muscat number goes to the employee (company_lead_routes.assigned_to, like Barka); no separate Muscat account.
-- Rollback: 135-review-small.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.property_alerts_run()'::regprocedure);
BEGIN
  IF position('ليوم التسعير (الأربعاء)' in def) = 0 THEN RAISE EXCEPTION 'property_alerts_run: Wednesday text not found'; END IF;
  def := replace(def, 'ليوم التسعير (الأربعاء)', 'للتسعير الآلي اليوم');
  EXECUTE def;
END $do$;

CREATE OR REPLACE FUNCTION crm_repair_private.close_visit_prep_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.tasks t
     SET done = true, completed_at = now(),
         notes = left(concat_ws(E'\n', t.notes, 'انقفلت لحالها يوم الزيارة (' || to_char(now() at time zone 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || ')'), 4000)
   WHERE NOT coalesce(t.done, false)
     AND t.title LIKE 'جهّز زيارات بكره %'
     AND substring(t.title from '(\d{4}-\d{2}-\d{2})') IS NOT NULL
     AND substring(t.title from '(\d{4}-\d{2}-\d{2})')::date <= (now() at time zone 'Asia/Muscat')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.close_visit_prep_tasks() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'close_visit_prep_tasks';
-- 00:10 Muscat = 20:10 UTC
SELECT cron.schedule('close_visit_prep_tasks', '10 20 * * *', $$ select crm_repair_private.close_visit_prep_tasks(); $$);

UPDATE public.company_lead_routes SET assigned_to = 'cffb3a2a-8412-4505-a2d2-a289c690a644', updated_at = now()
 WHERE route_key = 'muscat' AND assigned_to = 'ec2aec23-f5c8-4b79-8cf8-7435c721f092';
