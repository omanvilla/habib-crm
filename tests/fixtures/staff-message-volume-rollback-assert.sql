RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(to_jsonb(pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure))
 =(SELECT value FROM test_staff_volume30 WHERE key='function_before'),'SQL30 rollback restores exact report predecessor');
SELECT test_reservation_assert((SELECT jsonb_build_object('acl',proacl,'owner',proowner) FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure)
 =(SELECT value FROM test_staff_volume30 WHERE key='function_metadata_before'),'SQL30 rollback preserves original report owner/ACL');
SELECT test_reservation_assert(test_staff_volume30_security()=(SELECT value FROM test_staff_volume30 WHERE key='security_before'),
 'SQL30 rollback preserves every existing policy, helper and table/view security');
SELECT test_reservation_assert(test_staff_volume30_business()=(SELECT value FROM test_staff_volume30 WHERE key='business_before'),
 'SQL30 rollback preserves all original and synthetic business rows');
SET ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  PERFORM test_reservation_assert(crm_employee_performance('2026-10-01','2026-11-01')
   =(SELECT value FROM test_staff_volume30 WHERE key='before_'||n),'SQL30 rollback restores exact predecessor metrics for role '||n);
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT 'SQL30 staff message scope rollback passed' result;
