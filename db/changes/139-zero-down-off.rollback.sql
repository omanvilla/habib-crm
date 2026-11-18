-- Rollback of SQL139: removes the one-time job. If it already ran, the two pinned replies are switched back on.
SET LOCAL lock_timeout = '10s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'zero_down_pinned_off_20261201';
-- only when the job already switched them off (after 30 Nov 2026 20:05 UTC); before that they are still active
UPDATE public.whatsapp_reply_rules SET active = true, updated_at = now()
 WHERE id IN ('4d954dad-ec8c-4670-b1c1-e1baf79fa03b', 'c96a7596-66d5-4e01-940f-9e1b9d729d97') AND NOT active
   AND now() >= timestamptz '2026-11-30 20:05:00+00';
