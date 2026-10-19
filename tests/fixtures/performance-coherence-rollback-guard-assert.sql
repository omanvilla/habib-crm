SELECT test_reservation_assert((SELECT provolatile='v' FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure),
 'SQL28 rollback refusal preserves a later independent function change');
DO $$ DECLARE source text;BEGIN
 SELECT applied_definition INTO STRICT source FROM crm_repair_private.audit28_catalog_backup WHERE kind='function';
 EXECUTE source;
END $$;
