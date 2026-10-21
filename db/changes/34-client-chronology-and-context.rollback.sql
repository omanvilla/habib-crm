-- Data-preserving rollback. First restore the prior frontend AND webhook/send modules.
-- Legitimate intent events remain historical evidence; this does not delete them.
BEGIN;
DO $$DECLARE d text;BEGIN
 SELECT definition INTO d FROM crm_repair_private.client34_catalog_backup WHERE signature='public.crm_property_inquiry_candidates(uuid,integer,integer)';
 IF d IS NULL THEN RAISE EXCEPTION 'missing_candidate_backup';END IF;
 EXECUTE d;
END$$;
DROP FUNCTION IF EXISTS public.crm_apply_property_context_followup(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.crm_record_location_interest(uuid);
DROP FUNCTION IF EXISTS public.crm_client_first_contacts(uuid[]);
NOTIFY pgrst,'reload schema';
COMMIT;
