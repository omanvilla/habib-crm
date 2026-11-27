-- Rollback SQL163
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('crm_db_speed_probe', 'crm_db_speed_alert');
DROP FUNCTION IF EXISTS crm_repair_private.db_speed_check();
DROP FUNCTION IF EXISTS crm_repair_private.db_speed_summary(int);
DROP FUNCTION IF EXISTS crm_repair_private.db_speed_probe();
DROP TABLE IF EXISTS crm_repair_private.db_speed_probes;
