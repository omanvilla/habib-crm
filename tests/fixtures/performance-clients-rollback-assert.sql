DO $$BEGIN
 PERFORM test_assert((SELECT pg_get_functiondef(p.oid)=b.definition AND p.proacl::text IS NOT DISTINCT FROM b.acl AND p.proowner=b.owner_id FROM pg_proc p CROSS JOIN test_performance_clients_catalog b WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure),'SQL23 rollback did not restore function/ACL/owner exactly');
END$$;
