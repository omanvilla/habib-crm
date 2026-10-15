-- Revert only this dashboard migration; no business data or investment RLS changed.
BEGIN;
DO $$ DECLARE original record;
BEGIN
 SELECT * INTO STRICT original FROM crm_repair_private.dashboard_catalog_backup WHERE object_identity='crm_client_contact_queue(integer)';
 IF pg_get_functiondef('public.crm_client_contact_queue(integer)'::regprocedure) IS DISTINCT FROM original.installed_definition THEN
   RAISE EXCEPTION 'contact_queue_changed_since_dashboard_release';
 END IF;
 EXECUTE original.definition;
END $$;
DROP FUNCTION public.crm_dashboard_work(text,integer,integer);
DROP FUNCTION crm_repair_private.dashboard_row_in_scope(uuid,jsonb,text);
DROP TABLE crm_repair_private.dashboard_catalog_backup;
COMMIT;
