-- SQL30: successful human message volume follows the already-authorized inbox
-- line. A different primary client assignment does not erase that line's work.
-- Only the redundant client check inside staff_messages is removed; inquiry
-- evidence, conversation authorization, privacy guards and business rows stay intact.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit30_catalog_backup(
 identity text PRIMARY KEY,definition text NOT NULL,applied_definition text,
 acl aclitem[],owner_id oid NOT NULL,captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.audit30_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit30_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE current_definition text;previous record;current_acl aclitem[];current_owner oid;
BEGIN
 SELECT pg_get_functiondef(p.oid),p.proacl,p.proowner INTO STRICT current_definition,current_acl,current_owner
 FROM pg_proc p WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure;
 SELECT * INTO previous FROM crm_repair_private.audit30_catalog_backup
 WHERE identity='public.crm_employee_performance(date,date)';
 IF FOUND THEN
  IF (current_definition IS DISTINCT FROM previous.definition AND current_definition IS DISTINCT FROM previous.applied_definition)
   OR current_acl IS DISTINCT FROM previous.acl OR current_owner IS DISTINCT FROM previous.owner_id THEN
   RAISE EXCEPTION 'SQL30 apply refused: function or permissions changed since release';
  END IF;
 ELSE
  IF to_regclass('crm_repair_private.audit28_catalog_backup') IS NULL THEN
   RAISE EXCEPTION 'SQL30 requires the SQL28 performance predecessor';
  END IF;
  IF current_definition IS DISTINCT FROM (SELECT applied_definition FROM crm_repair_private.audit28_catalog_backup
    WHERE identity='public.crm_employee_performance(date,date)') THEN
   RAISE EXCEPTION 'SQL30 apply refused: performance differs from SQL28';
  END IF;
 END IF;
END $guard$;
INSERT INTO crm_repair_private.audit30_catalog_backup(identity,definition,acl,owner_id)
SELECT 'public.crm_employee_performance(date,date)',pg_get_functiondef(p.oid),p.proacl,p.proowner
FROM pg_proc p WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure
ON CONFLICT(identity) DO NOTHING;
DO $patch$
DECLARE original text;patched text;needle text;start_at integer;end_at integer;predicate_at integer;
BEGIN
 SELECT definition INTO STRICT original FROM crm_repair_private.audit30_catalog_backup
 WHERE identity='public.crm_employee_performance(date,date)';
 needle:=E'   and (v_role<>''agent'' or (m.conversation_client_id is null or crm_repair_private.can_access_client(m.company_id,m.conversation_client_id)))\n';
 start_at:=position(' staff_messages as materialized (' IN original);
 end_at:=position(' ), staff_counts as (' IN original);
 predicate_at:=position(needle IN original);
 IF start_at=0 OR end_at<=start_at OR predicate_at<=start_at OR predicate_at>=end_at
  OR length(original)-length(replace(original,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'SQL30 staff message predicate shape is unexpected';
 END IF;
 patched:=replace(original,needle,'');
 EXECUTE patched;
END $patch$;
UPDATE crm_repair_private.audit30_catalog_backup
SET applied_definition=pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure)
WHERE identity='public.crm_employee_performance(date,date)';
NOTIFY pgrst,'reload schema';
