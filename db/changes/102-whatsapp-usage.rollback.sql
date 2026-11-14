-- Rollback of SQL102: the cron job and the three functions go. Notifications already written stay as history.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_whatsapp_usage_alert') THEN PERFORM cron.unschedule('crm_whatsapp_usage_alert'); END IF;
END $cron$;
DROP FUNCTION IF EXISTS crm_repair_private.whatsapp_usage_alert();
DROP FUNCTION IF EXISTS public.crm_whatsapp_usage();
DROP FUNCTION IF EXISTS crm_repair_private.whatsapp_usage_rows(uuid);
