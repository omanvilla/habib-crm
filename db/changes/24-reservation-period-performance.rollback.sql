-- Revert executable behavior only. Never delete milestone/audit/receipt history.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$DECLARE b record;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.reservation_release_backup LOOP
  IF pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'newer function detected, review rollback: %',b.identity;
  END IF;
 END LOOP;
 DROP TRIGGER IF EXISTS crm_guard_reservation_milestones ON public.deals;
 DROP TRIGGER IF EXISTS crm_audit_reservation_milestones ON public.deals;
 FOR b IN SELECT * FROM crm_repair_private.reservation_release_backup LOOP EXECUTE b.definition;END LOOP;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
