-- Restore the exact preceding report without changing client/inbox permissions
-- or business records. Independent later definition/ACL changes stop rollback.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE b record;p record;
BEGIN
 SELECT * INTO STRICT b FROM crm_repair_private.audit30_catalog_backup
 WHERE identity='public.crm_employee_performance(date,date)';
 SELECT pg_get_functiondef(oid) definition,proacl,proowner INTO STRICT p
 FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure;
 IF b.applied_definition IS NULL OR p.definition IS DISTINCT FROM b.applied_definition
  OR p.proacl IS DISTINCT FROM b.acl OR p.proowner IS DISTINCT FROM b.owner_id THEN
  RAISE EXCEPTION 'SQL30 rollback refused: function or permissions changed since release';
 END IF;
 EXECUTE b.definition;
END $rollback$;
NOTIFY pgrst,'reload schema';
