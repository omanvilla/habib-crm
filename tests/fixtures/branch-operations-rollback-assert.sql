RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner)
 FROM pg_proc p WHERE p.oid='public.crm_save_viewing_atomic(jsonb,uuid)'::regprocedure)
 =(SELECT value FROM test_branch31 WHERE key='viewing_function_before'),
 'rollback restores the exact original atomic-viewing definition and privileges');
SELECT test_reservation_assert(to_regprocedure('public.crm_branch_performance(date,date)') IS NULL
 AND to_regprocedure('public.crm_branch_target_snapshot()') IS NULL
 AND to_regprocedure('public.crm_branch_monthly_targets(date)') IS NULL
 AND to_regprocedure('public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz)') IS NULL
 AND to_regprocedure('crm_repair_private.branch_period_metrics(date,date)') IS NULL,
 'rollback removes only the new branch RPCs/private aggregation function');
SELECT test_reservation_assert((SELECT jsonb_build_object('definition',pg_get_triggerdef(oid,true),'enabled',tgenabled)
 FROM pg_trigger WHERE tgrelid='public.properties'::regclass AND tgname='zzzz_property_branch_employee')
 =(SELECT value FROM test_branch31 WHERE key='trigger_before'),'rollback restores exact prior property trigger definition and enabled state');
SELECT test_reservation_assert((SELECT jsonb_agg(jsonb_build_object('id',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
 FROM pg_proc p WHERE p.oid IN ('public.crm_employee_performance(date,date)'::regprocedure,'public.crm_employee_target_snapshot()'::regprocedure,'crm_repair_private.performance_employee(uuid,text,timestamptz,uuid)'::regprocedure,'crm_repair_private.deal_period_metrics(date,date)'::regprocedure))
 =(SELECT value FROM test_branch31 WHERE key='legacy_functions_before'),'rollback keeps exact compatible old RPC definitions and privileges');
SELECT test_reservation_assert(test_branch31_business()=(SELECT value FROM test_branch31 WHERE key='business_before'),
 'rollback changes no business/profile/route or old employee target record');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY company_id,branch_key,month_start),'[]'::jsonb) FROM crm_repair_private.branch_monthly_targets t)
 =(SELECT value FROM test_branch31 WHERE key='branch_targets_after'),'rollback retains newly saved branch targets exactly');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM crm_repair_private.branch_target_history t)
 =(SELECT value FROM test_branch31 WHERE key='goal_history_after'),'rollback retains complete immutable target history exactly');
SELECT 'SQL31 non-destructive rollback passed' result;
