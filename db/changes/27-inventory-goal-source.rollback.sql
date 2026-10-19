-- Restore only the predecessor target function. Keep all properties, goals,
-- deals, activity and the private catalog backup exactly as they are.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE b record;BEGIN
 SELECT * INTO STRICT b FROM crm_repair_private.audit27_catalog_backup
 WHERE identity='public.crm_employee_target_snapshot()';
 IF b.applied_definition IS NULL OR
  pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.applied_definition THEN
  RAISE EXCEPTION 'SQL27 rollback refused: function changed since release: %',b.identity;
 END IF;
 EXECUTE b.definition;
END $$;
NOTIFY pgrst,'reload schema';
