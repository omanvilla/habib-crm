-- Coordinate with reverting the frontend to v4. Never shrink milli-OMR columns
-- or delete new activities, targets, reservations, receipts, audit or references.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE b record;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit25_catalog_backup WHERE identity NOT LIKE 'view:%' LOOP
  IF pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'SQL25 rollback refused: function changed since release: %',b.identity;
  END IF;
 END LOOP;
 FOR b IN SELECT * FROM crm_repair_private.audit25_catalog_backup WHERE identity NOT LIKE 'view:%' LOOP EXECUTE b.definition;END LOOP;
END $$;
DROP TRIGGER IF EXISTS crm_require_deposit_reservation ON public.deals;
-- Keep the validated invoker activity RPC usable by in-flight v5 clients. Keep
-- tightened trigger EXECUTE grants and the financial masking view barrier.
NOTIFY pgrst,'reload schema';
