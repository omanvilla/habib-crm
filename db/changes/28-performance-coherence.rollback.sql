-- Restore the exact reporting predecessor and its protected view. No business DML.
-- DROP uses RESTRICT (never CASCADE); independently added dependencies stop safely.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE b record;current_definition text;g record;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit28_catalog_backup LOOP
  current_definition:=CASE b.kind WHEN 'function' THEN pg_get_functiondef(to_regprocedure(b.identity))
    ELSE pg_get_viewdef(to_regclass(b.identity),true) END;
  IF b.applied_definition IS NULL OR current_definition IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'SQL28 rollback refused: object changed since release: %',b.identity;
  END IF;
 END LOOP;
 FOR b IN SELECT * FROM crm_repair_private.audit28_catalog_backup ORDER BY kind LOOP
  IF b.kind='function' THEN EXECUTE b.definition;
  ELSE
   DROP VIEW public.crm_deals_access RESTRICT;
   EXECUTE 'CREATE VIEW public.crm_deals_access'||CASE WHEN coalesce(array_length(b.reloptions,1),0)>0 THEN ' WITH ('||array_to_string(b.reloptions,',')||')' ELSE '' END||' AS '||b.definition;
   REVOKE ALL ON public.crm_deals_access FROM PUBLIC,anon,authenticated,service_role;
   FOR g IN SELECT a.*,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END grantee_name FROM aclexplode(b.acl) a LOOP
    EXECUTE 'GRANT '||g.privilege_type||' ON public.crm_deals_access TO '||g.grantee_name||CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
   END LOOP;
   EXECUTE format('ALTER VIEW public.crm_deals_access OWNER TO %I',b.owner_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
