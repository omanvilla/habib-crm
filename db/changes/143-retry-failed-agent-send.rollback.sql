-- Rollback SQL143: a reply Meta failed to send is not retried any more.
SET LOCAL lock_timeout = '10s';
SELECT cron.unschedule('crm-retry-failed-agent-sends');
DROP FUNCTION IF EXISTS crm_repair_private.retry_failed_agent_sends();
