-- Rollback of SQL116: the eight jobs go back to the shared :00 / :30 start, crm_properties_missing_details() loses its
-- company filter again and crm_property_missing() its fixed search_path. A job is moved back only from the SQL116 minute.
SET LOCAL lock_timeout = '10s';

DO $sql116rb$
DECLARE r record; v_id bigint;
BEGIN
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
    SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = r.jobname AND j.schedule = r.new_schedule;
    IF v_id IS NULL THEN RAISE EXCEPTION 'SQL116 rollback refused: job % is not on «%»', r.jobname, r.new_schedule; END IF;
    PERFORM cron.alter_job(v_id, schedule := r.old_schedule);
  END LOOP;
END $sql116rb$;

CREATE OR REPLACE FUNCTION public.crm_properties_missing_details()
RETURNS TABLE(id uuid, title text, area text, type text, branch_key text, created_at timestamptz, missing text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select p.id,p.title,p.area,p.type,p.branch_key,p.created_at,public.crm_property_missing(p.id)
  from public.properties p
  where p.status='available' and coalesce(p.archived,false)=false and p.created_at>='2025-01-01'
    and cardinality(public.crm_property_missing(p.id))>0
  order by p.created_at desc $$;
REVOKE ALL ON FUNCTION public.crm_properties_missing_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_properties_missing_details() TO authenticated;

ALTER FUNCTION public.crm_property_missing(uuid) RESET search_path;
