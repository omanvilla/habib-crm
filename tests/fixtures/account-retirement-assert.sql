-- Run after the actual administrative script has successfully executed twice.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT is_active IS FALSE FROM profiles WHERE id=test_id(11))
 AND (SELECT banned_until>now()+interval '99 years' FROM auth.users WHERE id=test_id(11)),
 'retirement disables the profile and bans the exact Auth account');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=test_id(11) AND (not_after IS NULL OR not_after>now()))
 AND NOT EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id=test_id(11)::text AND revoked IS DISTINCT FROM true),
 'all target sessions expire and false/null refresh revocation states become true');
SELECT test_reservation_assert((SELECT assigned_to=test_id(10) AND is_active IS TRUE FROM company_lead_routes WHERE id=test_id(20)),
 'only the Muscat operational route is handed to the existing owner');
SELECT test_reservation_assert(test_retirement32_business()=(SELECT value->'business' FROM test_retirement32 WHERE key='before'),
 'every business table and private financial/branch-target/history row remains byte-for-byte equal');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM profiles t WHERE id<>test_id(11))
 =(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM test_retirement32,LATERAL jsonb_array_elements(value->'profiles')x WHERE key='before' AND x->>'id'<>test_id(11)::text)
 AND (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM company_lead_routes t WHERE id<>test_id(20))
 =(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM test_retirement32,LATERAL jsonb_array_elements(value->'routes')x WHERE key='before' AND x->>'id'<>test_id(20)::text),
 'Maram, owner, manager, foreign profiles and all other routes remain exactly unchanged');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.users t WHERE id<>test_id(11))
 =(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM test_retirement32,LATERAL jsonb_array_elements(value->'users')x WHERE key='before' AND x->>'id'<>test_id(11)::text)
 AND (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.sessions t WHERE user_id<>test_id(11))
 =(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM test_retirement32,LATERAL jsonb_array_elements(value->'sessions')x WHERE key='before' AND x->>'user_id'<>test_id(11)::text)
 AND (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.refresh_tokens t WHERE user_id<>test_id(11)::text)
 =(SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::bigint),'[]') FROM test_retirement32,LATERAL jsonb_array_elements(value->'refresh')x WHERE key='before' AND x->>'user_id'<>test_id(11)::text),
 'all other Auth users, sessions and refresh metadata remain exactly unchanged');
SELECT test_reservation_assert((SELECT count(*)=1 FROM crm_repair_private.audit32_access_changes WHERE operation_key='synthetic-muscat-retirement-20261020')
 AND (SELECT company_id=test_id(1) AND target_user_id=test_id(11) AND actor_id=test_id(10)
  AND before_data#>>'{retained_profile,id}'=test_id(12)::text AND after_data->>'unrevoked_refresh_count'='0'
  AND after_data->>'execution_source'='owner_requested_admin_sql'
  FROM crm_repair_private.audit32_access_changes WHERE operation_key='synthetic-muscat-retirement-20261020'),
 'two executions produce exactly one identity-bound minimal administrative audit');
SELECT test_reservation_assert(NOT has_table_privilege('authenticated','crm_repair_private.audit32_access_changes','SELECT')
 AND NOT has_table_privilege('anon','crm_repair_private.audit32_access_changes','SELECT'),
 'retirement recovery metadata is not exposed through the app');
SET ROLE authenticated;
SELECT test_reservation_assert(crm_branch_performance('2026-01-01','2026-02-01')=(SELECT value FROM test_retirement32 WHERE key='performance_before')
 AND crm_branch_target_snapshot()=(SELECT value FROM test_retirement32 WHERE key='snapshot_before'),
 'inactive former account and changed route assignee do not remove or duplicate branch history and approved goals');
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(my_company() IS NULL AND my_role() IS NULL AND (SELECT count(*) FROM clients)=0,
 'an already-issued retired-subject JWT loses CRM role, tenant and client access immediately');
DO $$BEGIN
 BEGIN PERFORM crm_branch_target_snapshot();RAISE EXCEPTION 'retired snapshot accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(600),'expected_version',1,'time_unknown',true),test_id(37111));
  RAISE EXCEPTION 'retired write accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert(my_company()=test_id(1) AND my_role()='agent'
 AND (SELECT count(*) FROM clients WHERE id=test_id(101))=1
 AND (SELECT count(*) FROM clients WHERE id=test_id(102))=0
 AND jsonb_array_length(crm_branch_target_snapshot()->'branches')=1
 AND crm_branch_target_snapshot()#>>'{branches,0,branch_key}'='barka',
 'retained Barka account still sees its branch and cannot read the private investor');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT 'Administrative account retirement preservation and access assertions passed' result;
