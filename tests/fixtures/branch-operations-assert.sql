-- Full-catalog isolated SQL31 acceptance: branch identity, not mocked counters.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_branch31_business()=(SELECT value FROM test_branch31 WHERE key='business_before'),'SQL31 leaves every existing business/profile/route/employee-target row unchanged');
SELECT test_reservation_assert((SELECT jsonb_agg(jsonb_build_object('id',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
 FROM pg_proc p WHERE p.oid IN ('public.crm_employee_performance(date,date)'::regprocedure,'public.crm_employee_target_snapshot()'::regprocedure,'crm_repair_private.performance_employee(uuid,text,timestamptz,uuid)'::regprocedure,'crm_repair_private.deal_period_metrics(date,date)'::regprocedure))
 =(SELECT value FROM test_branch31 WHERE key='legacy_functions_before'),'legacy RPC definitions, ownership and ACL remain byte-identical for coordinated DB-first deployment');
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM public.employee_monthly_targets t JOIN crm_repair_private.branch_performance_owners o ON o.company_id=t.company_id AND o.employee_id=t.employee_id
 LEFT JOIN crm_repair_private.branch_monthly_targets b ON b.company_id=t.company_id AND b.branch_key=o.branch_key AND b.month_start=t.month_start
 WHERE b.company_id IS NULL OR (to_jsonb(t)-ARRAY['employee_id','new_properties_target','sold_target','commission_target','inquiries_target','visits_target'])
 IS DISTINCT FROM (to_jsonb(b)-ARRAY['branch_key','updated_by'])),'exact approved saved goals including zero, NULL and milli OMR are copied once');
SELECT test_reservation_assert((SELECT count(*) FROM crm_repair_private.branch_target_history WHERE source='approved_employee_target_copy')=
 (SELECT count(*) FROM crm_repair_private.branch_monthly_targets),'reapplying SQL31 creates no duplicate imported target history');
SELECT test_reservation_assert(NOT has_function_privilege('anon','public.crm_branch_performance(date,date)','execute')
 AND NOT has_function_privilege('anon','public.crm_branch_target_snapshot()','execute')
 AND NOT has_function_privilege('anon','public.crm_branch_monthly_targets(date)','execute')
 AND NOT has_function_privilege('anon','public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz)','execute')
 AND NOT has_function_privilege('authenticated','crm_repair_private.branch_period_metrics(date,date)','execute'),
 'no anonymous entry or authenticated access to the privileged private aggregation helper');
SELECT test_reservation_assert(NOT has_table_privilege('authenticated','crm_repair_private.branch_monthly_targets','select')
 AND NOT has_table_privilege('authenticated','crm_repair_private.branch_target_history','select')
 AND NOT has_table_privilege('authenticated','crm_repair_private.audit31_catalog_backup','select'),'private target storage, history and backups are not exposed');
SET ROLE authenticated;
INSERT INTO test_branch31 SELECT 'owner_performance',crm_branch_performance('2022-10-01','2022-11-01');
INSERT INTO test_branch31 SELECT 'owner_snapshot',crm_branch_target_snapshot();
SELECT test_reservation_assert((SELECT value->>'scope'='branch' AND value->'employees'=value->'branches'
 AND jsonb_array_length(value->'branches')=2 FROM test_branch31 WHERE key='owner_performance'),
 'owner receives exactly Muscat/Barka branch rows with explicit branch contract');
SELECT test_reservation_assert((SELECT count(DISTINCT row->>'branch_key')=2 AND bool_and(row->>'id'=row->>'branch_key')
 AND bool_and(row->>'employee_id'=row->>'branch_key') AND bool_and(row->>'name'=CASE row->>'branch_key' WHEN 'muscat' THEN 'مسقط' WHEN 'barka' THEN 'بركاء' END)
 FROM test_branch31 t,jsonb_array_elements(t.value->'branches')row WHERE key='owner_performance'),
 'branch identity contains no named-person key or duplicated account row');
SELECT test_reservation_assert((SELECT (m->>'reservations')::int=2 AND (m->>'active_reservations')::int=1
 AND (m->>'cancelled_reservations')::int=1 AND (m->>'expected_commission')::numeric=4500
 AND (m->>'commission_collected')::numeric=0 AND (m->>'sales')::int=0
 AND (m->>'successful_staff_messages')::int=2 AND (m->>'followup_clients')::int=1
 AND (m->>'new_properties')::int=2 AND (m->>'visit_cohort_total')::int=2 AND (m->>'visit_cohort_done')::int=2
 FROM (SELECT test_branch31_metric(value,'muscat') m FROM test_branch31 WHERE key='owner_performance') t),
 'two authors roll up once by Muscat: exactly2/4500 October bookings,2 human messages,1 unique followed-up client,2 added properties and2 completed visits');
SELECT test_reservation_assert((SELECT (m->>'reservations')::int=0 AND (m->>'commission_collected')::numeric=500.125
 AND (m->>'receipt_count')::int=1 AND (m->>'sales')::int=1
 FROM (SELECT test_branch31_metric(crm_branch_performance('2022-11-01','2022-12-01'),'muscat') m)t),
 'November contains actual partial collection and closing only; October bookings never move or duplicate, private 999999 receipt excluded');
SELECT test_reservation_assert((SELECT (m->>'reservations')::int=1 AND (m->>'expected_commission')::numeric=2500
 FROM (SELECT test_branch31_metric(crm_branch_performance('2022-10-31','2022-11-01'),'muscat') m)t),
 'Oman last-day payment at23:59:59 is included with exclusive UTC-translated end');
SELECT test_reservation_assert((SELECT (m#>>'{goals,inventory}')::int=0 AND m#>'{goals,followups}'='null'::jsonb
 AND (m#>>'{goals,expected_commission}')::numeric=5000.005 AND (m->>'configured')::boolean
 FROM (SELECT test_branch31_metric(crm_branch_monthly_targets('2022-10-01'),'muscat')m)t),
 'saved paused, unspecified and three-decimal goals survive branch migration without fallback invention');

-- Disabling the old login and moving the physical route to the owner is a test
-- transaction only. No fixture mutation is left behind for rollback verification.
RESET ROLE;
BEGIN;
UPDATE profiles SET is_active=false WHERE id=test_id(11);
UPDATE company_lead_routes SET assigned_to=test_id(10) WHERE company_id=test_id(1) AND route_key='muscat';
SET ROLE authenticated;
SELECT test_reservation_assert(crm_branch_performance('2022-10-01','2022-11-01')=(SELECT value FROM test_branch31 WHERE key='owner_performance'),
 'inactive former author and owner-run reception preserve exact historical branch totals');
SELECT test_reservation_assert(crm_branch_target_snapshot()=(SELECT value FROM test_branch31 WHERE key='owner_snapshot'),
 'Muscat stock, goals and achievements remain visible without an active Muscat staff account');
SELECT set_config('test.actor',test_id(11)::text,false);
DO $$BEGIN
 BEGIN PERFORM crm_branch_performance('2022-10-01','2022-11-01');RAISE EXCEPTION 'inactive branch performance accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_branch_target_snapshot();RAISE EXCEPTION 'inactive branch target accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_branch_monthly_targets('2022-10-01');RAISE EXCEPTION 'inactive branch goals accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(10)::text,false);
RESET ROLE;
UPDATE properties SET title='Synthetic unrelated property edit' WHERE id=test_id(32012);
SELECT test_reservation_assert((SELECT sourced_by=test_id(32000) FROM properties WHERE id=test_id(32012)),
 'unrelated property edit preserves original author after obsolete employee-rewrite trigger is disabled');
ROLLBACK;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_branch31_business()=(SELECT value FROM test_branch31 WHERE key='business_before'),
 'inactive-account and attribution tests restore all synthetic business state');

SET ROLE authenticated;
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_branch_performance('2022-10-01','2022-11-01')->'branches')=1
 AND crm_branch_performance('2022-10-01','2022-11-01')#>>'{branches,0,branch_key}'='barka'
 AND crm_branch_target_snapshot()#>>'{branches,0,branch_key}'='barka'
 AND jsonb_array_length(crm_branch_monthly_targets('2022-10-01')->'branches')=1,
 'Barka account receives only Barka across reports, achievements and goal definitions');
DO $$BEGIN
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-10-01','{}');RAISE EXCEPTION 'staff branch target save accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM crm_repair_private.branch_monthly_targets;RAISE EXCEPTION 'staff private target table readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_branch_performance('2022-10-01','2022-11-01')->'branches')=1
 AND crm_branch_performance('2022-10-01','2022-11-01')#>>'{branches,0,branch_key}'='muscat',
 'Muscat authorization cannot acquire a Barka row by changing dates');
SELECT set_config('test.actor',test_id(13)::text,false);
SELECT test_reservation_assert((SELECT bool_and(row->'expected_commission'='null'::jsonb AND row->'commission_collected'='null'::jsonb AND row->'company_commission'='null'::jsonb)
 FROM jsonb_array_elements(crm_branch_performance('2022-10-01','2022-11-01')->'branches')row),
 'manager branch reports retain existing financial masking and exclude private investment');
SELECT set_config('test.actor',test_id(32000)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_branch_performance('2022-10-01','2022-11-01')->'branches')=0
 AND jsonb_array_length(crm_branch_target_snapshot()->'branches')=0,'an active same-company account without an authorized route gets no branch data');

SELECT set_config('test.actor',test_id(10)::text,false);
INSERT INTO test_branch31 SELECT 'goals_old',test_branch31_metric(crm_branch_monthly_targets(date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date),'muscat');
INSERT INTO test_branch31 SELECT 'goals_saved',crm_save_branch_monthly_targets('muscat',date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,
 (value->'targets')||jsonb_build_object('inventory_target',0,'booking_commission_target',4321.005),(value->>'updated_at')::timestamptz)
FROM test_branch31 WHERE key='goals_old';
SELECT test_reservation_assert((SELECT value->>'branch_key'='muscat' AND (value#>>'{goals,inventory}')::int=0
 AND (value#>>'{goals,expected_commission}')::numeric=4321.005 AND NOT (value->>'replayed')::boolean
 AND value->'updated_at'<>(SELECT value->'updated_at' FROM test_branch31 WHERE key='goals_old')
 FROM test_branch31 WHERE key='goals_saved'),'owner branch goal save returns exact acknowledged new values and version');
SELECT test_reservation_assert((SELECT (crm_save_branch_monthly_targets('muscat',date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,
 value->'targets',(SELECT (value->>'updated_at')::timestamptz FROM test_branch31 WHERE key='goals_old'))->>'replayed')::boolean
 FROM test_branch31 WHERE key='goals_saved'),'identical retry with an older observed version is acknowledged without another write');
DO $$DECLARE payload jsonb;stamp timestamptz;BEGIN
 SELECT value->'targets',(value->>'updated_at')::timestamptz INTO payload,stamp FROM test_branch31 WHERE key='goals_old';
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat',date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,payload,stamp);RAISE EXCEPTION 'stale goal save accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('investment','2022-10-01',payload,NULL);RAISE EXCEPTION 'investment branch goal accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-10-02',payload,NULL);RAISE EXCEPTION 'non-month period accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-12-01',payload-'inventory_target',NULL);RAISE EXCEPTION 'missing goal accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-12-01',payload||'{"actor_id":"forged"}',NULL);RAISE EXCEPTION 'extra control field accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-12-01',payload||'{"inventory_target":1.5}',NULL);RAISE EXCEPTION 'fractional count target accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-12-01',payload||'{"inventory_target":-1}',NULL);RAISE EXCEPTION 'negative count target accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_branch_monthly_targets('muscat','2022-12-01',payload||'{"booking_commission_target":4.0001}',NULL);RAISE EXCEPTION 'sub-milli commission target accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
SELECT test_reservation_assert((SELECT (m#>>'{goals,inventory}')::int=0 AND (m#>>'{goals,expected_commission}')::numeric=4321.005
 FROM (SELECT test_branch31_metric(crm_branch_target_snapshot(),'muscat')m)t),
 'saved current-month goals are reused by the dashboard snapshot with no stale fallback');
INSERT INTO test_branch31 SELECT 'new_month',crm_save_branch_monthly_targets('muscat','2022-12-01',value->'targets',NULL)
FROM test_branch31 WHERE key='goals_saved';
SELECT test_reservation_assert((SELECT value->>'month_start'='2022-12-01' AND (value->>'configured')::boolean FROM test_branch31 WHERE key='new_month'),
 'an explicit different month is independently saved and acknowledged');
SELECT test_reservation_assert((SELECT (m#>>'{goals,expected_commission}')::numeric=5000.005
 FROM (SELECT test_branch31_metric(crm_branch_monthly_targets('2022-10-01'),'muscat')m)t),
 'editing other months never changes previously approved historical goal values');
DO $$DECLARE saved jsonb;BEGIN
 BEGIN
  SELECT crm_save_branch_monthly_targets('muscat','2022-08-01',(value->'targets')||'{"inventory_target":1.0}'::jsonb,NULL)
   INTO saved FROM test_branch31 WHERE key='goals_saved';
  PERFORM test_reservation_assert((saved#>>'{goals,inventory}')::int=1,'whole JSON decimal count is accepted as the integer1');
  RAISE EXCEPTION 'rollback decimal-goal fixture';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'rollback decimal-goal fixture' THEN RAISE;END IF;
 END;
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT count(*) FROM crm_repair_private.branch_target_history WHERE source='owner_branch_target_save')=2,
 'only two real branch-month changes create history; replay/stale/invalid requests create none');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.branch_target_history WHERE source='owner_branch_target_save'
 AND (actor_id<>test_id(10) OR after_data->>'updated_by'<>test_id(10)::text)),'goal audit actor derives from authorized session, never supplied JSON');
SELECT test_reservation_assert(test_branch31_business()=(SELECT value FROM test_branch31 WHERE key='business_before'),
 'goal saves leave prior employee goals and every business row untouched');
INSERT INTO test_branch31 SELECT 'branch_targets_after',coalesce(jsonb_agg(to_jsonb(t) ORDER BY company_id,branch_key,month_start),'[]'::jsonb) FROM crm_repair_private.branch_monthly_targets t;
INSERT INTO test_branch31 SELECT 'goal_history_after',coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM crm_repair_private.branch_target_history t;
SELECT 'SQL31 branch operations acceptance passed' result;
