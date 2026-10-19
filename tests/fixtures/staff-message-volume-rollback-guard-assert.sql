SELECT test_reservation_assert((SELECT provolatile='v' FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure),
 'SQL30 apply/rollback refusal preserves an independent later function change');
DO $$ DECLARE saved text;BEGIN
 SELECT applied_definition INTO STRICT saved FROM crm_repair_private.audit30_catalog_backup;
 EXECUTE saved;
END $$;
