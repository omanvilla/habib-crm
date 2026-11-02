-- Rollback for SQL54. Unschedule the queue job first if it was created:
--   SELECT cron.unschedule('habib_visit_followups_queue');
DROP FUNCTION IF EXISTS public.crm_visit_followup_reject(uuid);
DROP FUNCTION IF EXISTS public.crm_queue_visit_followups(integer);
DROP FUNCTION IF EXISTS public.crm_visit_followup_text(integer);
DROP TABLE IF EXISTS public.whatsapp_visit_followups;
