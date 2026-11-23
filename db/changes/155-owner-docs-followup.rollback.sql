-- Rollback of SQL155: the job and the function. Rows already in whatsapp_outreach_queue (kind owner_docs) stay as a record;
-- approved ones still waiting would be sent by whatsapp-outreach, so they are skipped here.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'owner_docs_followup_queue';
UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'sql155_rolled_back' WHERE kind = 'owner_docs' AND status = 'approved';
DROP FUNCTION IF EXISTS crm_repair_private.owner_docs_queue();
