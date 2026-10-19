-- Guarded catalog rollback only. Preserve every real inquiry/activity/reason row.
SET LOCAL lock_timeout='5s';
DO $$ DECLARE b record;actual text;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit29_catalog_backup LOOP
  actual:=CASE WHEN to_regprocedure(b.identity) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(b.identity)) END;
  IF actual IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'SQL29 rollback refused: function changed since release: %',b.identity;
  END IF;
 END LOOP;
 FOR b IN SELECT * FROM crm_repair_private.audit29_catalog_backup LOOP
  IF b.definition IS NULL THEN EXECUTE 'DROP FUNCTION '||b.identity;
  ELSE EXECUTE b.definition;END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
