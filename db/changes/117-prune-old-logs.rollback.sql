-- Rollback of SQL117: the weekly job stops and its function goes. No deleted row comes back.
SET LOCAL lock_timeout = '10s';
SELECT cron.unschedule('crm_prune_old_logs');
DROP FUNCTION IF EXISTS crm_repair_private.prune_old_logs();
