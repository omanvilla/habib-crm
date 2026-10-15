-- Disable semantic writes while preserving already recorded evidence and
-- inquiries. Keep the additive column/enum value so historical rows remain valid.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DROP FUNCTION IF EXISTS public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean);
DROP FUNCTION IF EXISTS public.crm_property_inquiry_candidates(uuid,integer,integer);
DROP FUNCTION IF EXISTS crm_repair_private.semantic_property_is_private(uuid,uuid);
DO $rollback$
DECLARE saved record;
BEGIN
 SELECT * INTO saved FROM crm_repair_private.semantic_inquiry_backup_20261015
  WHERE object_identity='public.refresh_client_request_summary(uuid)';
 IF NOT FOUND OR pg_get_functiondef('public.refresh_client_request_summary(uuid)'::regprocedure) IS DISTINCT FROM saved.applied_definition THEN
  RAISE EXCEPTION 'request summary changed since semantic release; review before rollback';END IF;
 EXECUTE saved.original_definition;
END $rollback$;
