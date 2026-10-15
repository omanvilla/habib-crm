-- Reverses only the metric function. No business records or security policies change.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE saved record;
BEGIN
 SELECT * INTO saved FROM crm_repair_private.performance_clients_backup_20261015
 WHERE object_identity='public.crm_employee_performance(date,date)';
 IF NOT FOUND THEN RAISE EXCEPTION 'performance client metrics backup is missing'; END IF;
 IF pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure) IS DISTINCT FROM saved.applied_definition THEN
  RAISE EXCEPTION 'performance function has changed since this release; review before rollback';
 END IF;
 EXECUTE saved.original_definition;
END $rollback$;

