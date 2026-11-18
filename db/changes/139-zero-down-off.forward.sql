-- SQL139 (18 Nov 2026, decision 15 of Ahmed's review, docs/مراجعة-القرارات-20261118.md: «يوقف لحاله 30 نوفمبر»).
-- The zero-down offer of Sultan Haitham City ends 30 Nov 2026. A one-time cron at 1 Dec 2026 00:05 Muscat (30 Nov 20:05 UTC)
-- switches off the two pinned replies about it (active=false, a deactivation Ahmed decided, nothing is deleted) and then
-- unschedules itself. The reply agent drops the offer's brain lines from the same day by itself (index.ts, ZERO_DOWN).
-- Rollback: 139-zero-down-off.rollback.sql
SET LOCAL lock_timeout = '10s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'zero_down_pinned_off_20261201';
SELECT cron.schedule('zero_down_pinned_off_20261201', '5 20 30 11 *', $job$
  UPDATE public.whatsapp_reply_rules SET active = false, updated_at = now()
   WHERE id IN ('4d954dad-ec8c-4670-b1c1-e1baf79fa03b', 'c96a7596-66d5-4e01-940f-9e1b9d729d97') AND active;
  SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'zero_down_pinned_off_20261201';
$job$);
