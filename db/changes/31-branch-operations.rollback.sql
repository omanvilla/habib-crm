-- SQL31 rollback restores the prior automatic-property trigger state and removes
-- only this release's new RPCs, restoring the exact historical-viewing validator.
-- Saved branch targets and their immutable history
-- remain private for recovery/reapplication; no business rows are deleted.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE b record;p record;command text;
BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit31_catalog_backup WHERE kind IN('function','existing_function') LOOP
  SELECT pg_get_functiondef(oid) definition,proacl,proowner INTO p FROM pg_proc WHERE oid=to_regprocedure(b.identity);
  IF p.definition IS NULL OR p.definition IS DISTINCT FROM b.applied_definition
    OR p.proacl IS DISTINCT FROM b.applied_acl OR p.proowner IS DISTINCT FROM b.applied_owner THEN
   RAISE EXCEPTION 'SQL31 rollback refused: function or permissions changed: %',b.identity;
  END IF;
 END LOOP;
 -- CREATE OR REPLACE retains ACL/owner; both are checked above and were never
 -- changed by forward. Restore the exact captured old authorization definition.
 FOR b IN SELECT * FROM crm_repair_private.audit31_catalog_backup WHERE kind='existing_function' LOOP
  EXECUTE b.definition;
 END LOOP;
 SELECT * INTO STRICT b FROM crm_repair_private.audit31_catalog_backup WHERE identity='public.properties.zzzz_property_branch_employee';
 SELECT pg_get_triggerdef(t.oid,true) definition,t.tgenabled INTO p FROM pg_trigger t
 WHERE t.tgrelid='public.properties'::regclass AND t.tgname='zzzz_property_branch_employee' AND NOT t.tgisinternal;
 IF p.definition IS DISTINCT FROM b.definition OR p.tgenabled IS DISTINCT FROM 'D'::"char" THEN
  RAISE EXCEPTION 'SQL31 rollback refused: property attribution trigger changed';
 END IF;
 DROP FUNCTION public.crm_branch_performance(date,date);
 DROP FUNCTION public.crm_branch_target_snapshot();
 DROP FUNCTION public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz);
 DROP FUNCTION public.crm_branch_monthly_targets(date);
 DROP FUNCTION crm_repair_private.branch_period_metrics(date,date);
 command:=CASE b.enabled WHEN 'O' THEN 'ENABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'D' THEN 'DISABLE' END;
 IF command IS NULL THEN RAISE EXCEPTION 'SQL31 unknown predecessor trigger state';END IF;
 EXECUTE 'ALTER TABLE public.properties '||command||' TRIGGER zzzz_property_branch_employee';
END $rollback$;
NOTIFY pgrst,'reload schema';
