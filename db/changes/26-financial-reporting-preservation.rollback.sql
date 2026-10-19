-- Coordinate with reverting the financial report UI. Preserve all business rows,
-- ledger events, catalog backups and three-decimal expense amounts.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE b record;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit26_catalog_backup LOOP
  IF pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'SQL26 rollback refused: function changed since release: %',b.identity;
  END IF;
 END LOOP;
 FOR b IN SELECT * FROM crm_repair_private.audit26_catalog_backup LOOP EXECUTE b.definition;END LOOP;
END $$;
-- Keep the read-only owner report and private amount helper for in-flight clients.
NOTIFY pgrst,'reload schema';
