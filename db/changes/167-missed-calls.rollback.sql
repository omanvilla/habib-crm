-- Rollback of SQL167 (missed calls). Keeps public.crm_missed_calls (the call log is data: drop it only with Ahmed's yes).
SET LOCAL lock_timeout = '10s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm_missed_call_tasks';
DROP FUNCTION IF EXISTS crm_repair_private.missed_call_tasks();
DROP FUNCTION IF EXISTS public.crm_missed_call_done(uuid, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.crm_missed_call_plan(text, text, boolean);
DROP FUNCTION IF EXISTS crm_repair_private.missed_call_at_property(text);
DROP FUNCTION IF EXISTS crm_repair_private.missed_call_period(timestamptz);
UPDATE public.whatsapp_automation_runtime SET missed_call_auto = false;
-- device keys stop working (the phones' requests get bad_key)
UPDATE crm_repair_private.missed_call_devices SET key_hash = 'revoked-' || device || '-' || extract(epoch FROM now())::bigint;
