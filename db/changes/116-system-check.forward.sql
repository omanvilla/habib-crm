-- SQL116 (17 Nov 2026, Ahmed: «سوّ فحص شامل للنظام وعدّل عليه»). Two small things the check of the live database found:
-- 1. crm_properties_missing_details() is SECURITY DEFINER, open to every signed-in account, and had no company filter:
--    it listed the properties with missing details to any account, also one outside the company. It now returns only
--    the caller's company (my_company() is NULL for an inactive or outside account, so they get nothing). No screen
--    calls it today. crm_property_missing() gets a fixed search_path (the advisor warning); its body already names the
--    schema of everything it reads.
-- 2. Ten scheduled jobs all started on the same second at :00 and :30 (with the every-minute tick), on a small server:
--    edge functions answered 503 at the top of the hour and jobs failed with «job startup timeout». Each job keeps
--    its cadence and its working hours and only moves to its own minute. outreach_send_approved and the every-minute
--    owner_price_study_tick stay where they are; sheet_sync_every_5_min belongs to SQL115 and is not touched.
-- A job is moved only when it still has the schedule read on 17 Nov; anything else is refused, nothing half done.
-- Rollback: 116-system-check.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $sql116$
DECLARE r record; v_id bigint;
BEGIN
  IF md5(pg_get_functiondef('public.crm_properties_missing_details()'::regprocedure)) <> 'a08d6e6de85b66b00c9f0d624218c9bb' THEN
    RAISE EXCEPTION 'SQL116 refused: crm_properties_missing_details changed since 17 Nov 2026, read it again first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('habib_instagram_media_discovery', '*/5 * * * *',     '1-59/5 * * * *'),
    ('crm_property_alerts_run',         '*/10 * * * *',    '3-59/10 * * * *'),
    ('openai_credit_alert',             '*/10 * * * *',    '4-59/10 * * * *'),
    ('owner_price_study_unpriced',      '*/10 * * * *',    '9-59/10 * * * *'),
    ('crm_whatsapp_usage_alert',        '*/15 * * * *',    '2-59/15 * * * *'),
    ('owner_whatsapp_keepalive',        '*/15 * * * *',    '12-59/15 * * * *'),
    ('habib_visit_followups_auto_send', '*/15 5-16 * * *', '8-59/15 5-16 * * *'),
    ('owner_price_study_held',          '*/30 * * * *',    '18,48 * * * *')
  ) v(jobname, old_schedule, new_schedule) LOOP
    SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = r.jobname AND j.schedule = r.old_schedule;
    IF v_id IS NULL THEN RAISE EXCEPTION 'SQL116 refused: job % is not on «%» any more', r.jobname, r.old_schedule; END IF;
    PERFORM cron.alter_job(v_id, schedule := r.new_schedule);
  END LOOP;
END $sql116$;

CREATE OR REPLACE FUNCTION public.crm_properties_missing_details()
RETURNS TABLE(id uuid, title text, area text, type text, branch_key text, created_at timestamptz, missing text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select p.id,p.title,p.area,p.type,p.branch_key,p.created_at,public.crm_property_missing(p.id)
  from public.properties p
  where p.company_id = public.my_company()
    and p.status='available' and coalesce(p.archived,false)=false and p.created_at>='2025-01-01'
    and cardinality(public.crm_property_missing(p.id))>0
  order by p.created_at desc $$;
REVOKE ALL ON FUNCTION public.crm_properties_missing_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_properties_missing_details() TO authenticated;

ALTER FUNCTION public.crm_property_missing(uuid) SET search_path = '';
