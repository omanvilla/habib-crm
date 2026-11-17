-- SQL117 (17 Nov 2026, Ahmed: «نظّف السجلات القديمة», then «نعم، سوّها» for a weekly job). The same rule he approved for
-- the one-time deletion, every Friday at 05:35 Oman time (01:35 UTC), a minute no other job starts on:
--   whatsapp_webhook_events: rows older than 30 days that are processed and not dead-lettered (the raw Meta copy; the
--     messages themselves live in whatsapp_messages and are never touched; an unprocessed or dead-lettered row stays);
--   cron.job_run_details: runs older than 14 days (the home reads the last 8 days).
-- client_request_events is NOT pruned: it is the history of every request and crm_activity_metrics reads it.
-- Backend only: no signed-in account can call the function.
-- Rollback: 117-prune-old-logs.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.prune_old_logs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_webhook bigint; v_runs bigint;
BEGIN
  DELETE FROM public.whatsapp_webhook_events
   WHERE created_at < now() - interval '30 days' AND processed AND NOT coalesce(dead_letter, false);
  GET DIAGNOSTICS v_webhook = ROW_COUNT;
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '14 days';
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  RETURN jsonb_build_object('webhook_events', v_webhook, 'cron_runs', v_runs);
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.prune_old_logs() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('crm_prune_old_logs', '35 1 * * 5', 'select crm_repair_private.prune_old_logs()');
