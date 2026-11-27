-- Rollback for SQL166. To stop the automatic alert at once without a rollback: UPDATE whatsapp_automation_runtime SET new_listing_auto = false.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('outreach_auto_new_listing', 'outreach_listing_details');
DROP FUNCTION IF EXISTS crm_repair_private.outreach_auto_new_listing();
ALTER TABLE public.whatsapp_automation_runtime DROP COLUMN IF EXISTS new_listing_auto;
