-- Rollback of SQL135.
SET LOCAL lock_timeout = '10s';
DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.property_alerts_run()'::regprocedure);
BEGIN
  def := replace(def, 'للتسعير الآلي اليوم', 'ليوم التسعير (الأربعاء)');
  EXECUTE def;
END $do$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'close_visit_prep_tasks';
DROP FUNCTION IF EXISTS crm_repair_private.close_visit_prep_tasks();
UPDATE public.company_lead_routes SET assigned_to = 'ec2aec23-f5c8-4b79-8cf8-7435c721f092', updated_at = now()
 WHERE route_key = 'muscat' AND assigned_to = 'cffb3a2a-8412-4505-a2d2-a289c690a644';
