RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(to_jsonb(pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure))
 =(SELECT value FROM test_coherence28 WHERE key='function_before'),'SQL28 rollback restores exact preceding performance function');
SELECT test_reservation_assert(to_jsonb(pg_get_viewdef('public.crm_deals_access'::regclass,true))
 =(SELECT value FROM test_coherence28 WHERE key='view_before'),'SQL28 rollback restores exact preceding protected view');
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_coherence28 WHERE key='business_before'),
 'SQL28 tests and rollback retain every prior business row');
SELECT test_reservation_assert((SELECT to_jsonb(relacl) FROM pg_class WHERE oid='public.crm_deals_access'::regclass)
 =(SELECT value FROM test_coherence28 WHERE key='view_acl_before'),'SQL28 rollback restores original view ACL');
SELECT 'performance coherence rollback passed' result;
