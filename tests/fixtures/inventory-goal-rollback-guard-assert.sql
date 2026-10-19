-- Run only after the actual SQL27 rollback file refused the changed function.
SELECT test_reservation_assert((SELECT provolatile='v' FROM pg_proc WHERE oid='public.crm_employee_target_snapshot()'::regprocedure),
 'guarded rollback does not overwrite a subsequent definition change');
DO $$ DECLARE source text;BEGIN
 SELECT applied_definition INTO STRICT source FROM crm_repair_private.audit27_catalog_backup;
 EXECUTE source;
END $$;
