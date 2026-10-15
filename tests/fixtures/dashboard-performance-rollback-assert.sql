-- Isolated fixture only. Run SQL20 rollback after its forward/assertion files.
DO $$DECLARE saved record;actual jsonb;BEGIN
 PERFORM test_assert((SELECT pg_get_functiondef(p.oid)=b.definition AND p.proacl::text IS NOT DISTINCT FROM b.acl AND p.proowner=b.owner_id FROM pg_proc p CROSS JOIN test_dashboard_performance_catalog b WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure),'rollback did not restore original function/ACL/owner exactly');
 FOR saved IN SELECT * FROM test_dashboard_performance_rows LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',saved.table_name) INTO actual USING saved.id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM saved.row_data,'rollback changed business row: '||saved.table_name);
 END LOOP;
END$$;
SELECT 'PASS exact function rollback, retained authorization/ACL, unchanged business records' AS result;
