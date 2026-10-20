-- Run after full investment fixture + SQL18 + dashboard-workspace-before + SQL19.
BEGIN;
CREATE FUNCTION test_dashboard_queue_identical() RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual jsonb;expected jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') INTO actual FROM crm_client_contact_queue(2000) q;
 SELECT rows INTO STRICT expected FROM test_dashboard_queue_before WHERE actor=auth.uid();
 -- The legacy array_agg orders only by created_at. Equal-time requests may choose
 -- either id after a plan change; every returned field/count and earliest time must match.
 PERFORM test_assert((SELECT jsonb_agg(x-'active_request_id' ORDER BY x->>'client_id') FROM jsonb_array_elements(actual)x)
   IS NOT DISTINCT FROM (SELECT jsonb_agg(x-'active_request_id' ORDER BY x->>'client_id') FROM jsonb_array_elements(expected)x),
   'contact queue semantics changed for '||auth.uid());
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_client_contact_queue(2000) q
   LEFT JOIN client_requests r ON r.id=q.active_request_id
   WHERE q.active_request_id IS NOT NULL AND (r.id IS NULL OR r.client_id<>q.client_id OR r.created_at<>q.oldest_pending_at)),
   'contact queue selected request is not an earliest unanswered request');
END $$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(11)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(12)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(13)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(14)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(15)::text,false);SELECT test_dashboard_queue_identical();
SELECT set_config('test.actor',test_id(16)::text,false);SELECT test_dashboard_queue_identical();
RESET ROLE;
-- Current-day synthetic action records. Disable triggers only to construct old/stale
-- assignments; the assertions themselves exercise the actual RLS and new invoker RPC.
SET session_replication_role=replica;
UPDATE viewings SET viewing_date=(now() AT TIME ZONE 'Asia/Muscat')::date,status=CASE WHEN id=test_id(600) THEN 'done' ELSE 'scheduled' END
 WHERE id IN(test_id(600),test_id(601),test_id(602),test_id(603));
UPDATE deals SET stage='negotiation' WHERE id IN(test_id(800),test_id(801),test_id(802),test_id(803));
UPDATE client_requests SET next_followup=(now() AT TIME ZONE 'Asia/Muscat')::date,lead_temperature='hot' WHERE id IN(test_id(200),test_id(201),test_id(202),test_id(206));
-- The preceding owner-creation suite commits request2501 with a fixed follow-up
-- date (2026-10-20). Once that day arrives it correctly becomes a third due
-- private client. Give this known inherited synthetic request a deterministic
-- future date for this transaction, then explicitly test its transition to due
-- below. The final ROLLBACK restores the preceding suite's original record.
UPDATE client_requests SET next_followup=(now() AT TIME ZONE 'Asia/Muscat')::date+1
 WHERE id=test_id(2501) AND client_id=test_id(2500) AND company_id=test_id(1);
-- Other suites may have committed their own owner follow-up fixture. Change only
-- the six records this suite owns; never turn unrelated synthetic tasks urgent.
UPDATE tasks SET due_date=(now() AT TIME ZONE 'Asia/Muscat')::date,priority='high'
 WHERE id IN(test_id(900),test_id(901),test_id(902),test_id(903),test_id(904),test_id(905));
INSERT INTO tasks(id,company_id,user_id,client_id,title,due_date) SELECT test_id(3000+n),test_id(1),test_id(11),test_id(100),'Synthetic page task '||n,(now() AT TIME ZONE 'Asia/Muscat')::date FROM generate_series(1,25)n;
SET session_replication_role=origin;
CREATE FUNCTION test_dashboard_no_private(p_result jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM test_assert(p_result::text NOT LIKE '%PRIVATE%','private sentinel in ordinary dashboard');
 PERFORM test_assert(p_result::text NOT LIKE '%'||test_id(102)::text||'%','private client id leaked');
 PERFORM test_assert(p_result::text NOT LIKE '%'||test_id(206)::text||'%','mixed-parent private request leaked');
 PERFORM test_assert(p_result::text NOT LIKE '%'||test_id(603)::text||'%','mixed-parent private viewing leaked');
 PERFORM test_assert(p_result::text NOT LIKE '%'||test_id(803)::text||'%','mixed-parent private deal leaked');
 PERFORM test_assert(p_result::text NOT LIKE '%'||test_id(905)::text||'%','private viewing-only task leaked');
END $$;
SELECT test_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.crm_dashboard_work(text,integer,integer)'::regprocedure),'dashboard public RPC must be invoker');
SELECT test_assert(NOT has_function_privilege('anon','public.crm_dashboard_work(text,integer,integer)','EXECUTE'),'anonymous dashboard execute');
SELECT test_assert(NOT has_function_privilege('service_role','public.crm_dashboard_work(text,integer,integer)','EXECUTE'),'service dashboard execute');
SELECT test_assert(NOT has_table_privilege('authenticated','crm_repair_private.dashboard_catalog_backup','SELECT'),'private backup exposed');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
DO $$DECLARE b jsonb:=crm_dashboard_work('branches');i jsonb:=crm_dashboard_work('investment');p jsonb;BEGIN
 PERFORM test_dashboard_no_private(b);
 PERFORM test_assert(b->>'as_of'=(now() AT TIME ZONE 'Asia/Muscat')::date::text,'Oman day mismatch');
 PERFORM test_assert((b->>'generated_at')::timestamptz=now(),'refresh timestamp missing');
 PERFORM test_assert((b#>>'{counts,followups_due}')::int=2,'owner branch due count');
 PERFORM test_assert((b#>>'{counts,hot_requests}')::int=2,'owner branch hot count');
 PERFORM test_assert((b#>>'{counts,viewings_today}')::int=2,'owner branch visits count');
 PERFORM test_assert((b#>>'{counts,open_deals}')::int=2,'owner branch deals count');
 PERFORM test_assert((b#>>'{counts,urgent_tasks}')::int=27,'owner branch urgent task count');
 PERFORM test_assert((b#>>'{totals,tasks}')::int=27 AND jsonb_array_length(b->'tasks')=20,'bounded tasks/exact total mismatch');
 PERFORM test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(b->'visits') v WHERE v->>'id'=test_id(600)::text AND v->>'status'='done'),'today completed visit missing from drilldown');
 p:=crm_dashboard_work('branches',20,20);
 PERFORM test_assert(jsonb_array_length(p->'tasks')=7 AND p->'counts'=b->'counts','pagination lost data or changed count');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'tasks') a JOIN jsonb_array_elements(b->'tasks') z ON a->>'id'=z->>'id'),'pagination duplicate tasks');
 PERFORM test_assert((i#>>'{counts,followups_due}')::int=2,'owner private due count');
 PERFORM test_assert((SELECT jsonb_agg(r->>'client_id' ORDER BY r->>'client_id') FROM jsonb_array_elements(i->'followups')r)
   =to_jsonb(ARRAY[test_id(102)::text,test_id(106)::text]),'owner private due clients must match the two current-day fixtures exactly');
 PERFORM test_assert((i#>>'{counts,hot_requests}')::int=2,'owner private hot count');
 PERFORM test_assert((i#>>'{counts,viewings_today}')::int=2,'owner private visits count');
 PERFORM test_assert((i#>>'{counts,open_deals}')::int=2,'owner private deals count');
 PERFORM test_assert((i#>>'{counts,urgent_tasks}')::int=4,'owner private indirect task count');
 PERFORM test_assert(i::text LIKE '%'||test_id(206)::text||'%','private request on ordinary identity missing');
 PERFORM test_assert(i::text LIKE '%'||test_id(905)::text||'%','private indirect viewing-only task missing');
 PERFORM test_assert(i::text NOT LIKE '%'||test_id(200)::text||'%','ordinary request entered private dashboard');
 IF EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(2501) AND client_id=test_id(2500)) THEN
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i->'followups')r WHERE r->>'id'=test_id(2501)::text),
   'tomorrow private follow-up must not be counted today');
  UPDATE client_requests SET next_followup=(now() AT TIME ZONE 'Asia/Muscat')::date WHERE id=test_id(2501);
  p:=crm_dashboard_work('investment');
  PERFORM test_assert((p#>>'{counts,followups_due}')::int=3
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'followups')r WHERE r->>'id'=test_id(2501)::text AND r->>'client_id'=test_id(2500)::text),
   'private follow-up scheduled for today must add its exact third client');
  PERFORM test_assert((crm_dashboard_work('branches')#>>'{counts,followups_due}')::int=2,
   'newly due private follow-up must not change the branch count');
  UPDATE client_requests SET next_followup=(now() AT TIME ZONE 'Asia/Muscat')::date+1 WHERE id=test_id(2501);
  PERFORM test_assert((crm_dashboard_work('investment')#>>'{counts,followups_due}')::int=2,
   'rescheduling the private follow-up to tomorrow restores the exact due count');
 END IF;
 BEGIN PERFORM crm_dashboard_work('all');RAISE EXCEPTION 'invalid scope accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(11)::text,false);
DO $$DECLARE x jsonb:=crm_dashboard_work('branches');BEGIN
 PERFORM test_dashboard_no_private(x);
 PERFORM test_assert((x#>>'{counts,viewings_today}')::int=1 AND (x#>>'{counts,open_deals}')::int=1,'Muscat work count');
 PERFORM test_assert(x::text NOT LIKE '%'||test_id(101)::text||'%' AND x::text NOT LIKE '%'||test_id(201)::text||'%','Barka leaked to Muscat');
 BEGIN PERFORM crm_dashboard_work('investment');RAISE EXCEPTION 'staff investment accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM test_assert(NOT crm_repair_private.dashboard_row_in_scope(test_id(1),jsonb_build_object('request_id',test_id(206)),'investment'),'staff private classifier oracle');
END $$;
SELECT set_config('test.actor',test_id(12)::text,false);
DO $$DECLARE x jsonb:=crm_dashboard_work('branches');BEGIN
 PERFORM test_dashboard_no_private(x);
 PERFORM test_assert((x#>>'{counts,viewings_today}')::int=1 AND (x#>>'{counts,open_deals}')::int=1,'Barka work count');
 PERFORM test_assert(x::text NOT LIKE '%'||test_id(100)::text||'%' AND x::text NOT LIKE '%'||test_id(200)::text||'%','Muscat leaked to Barka');
 BEGIN PERFORM crm_dashboard_work('investment');RAISE EXCEPTION 'staff investment accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(13)::text,false);
DO $$BEGIN PERFORM test_dashboard_no_private(crm_dashboard_work('branches'));BEGIN PERFORM crm_dashboard_work('investment');RAISE EXCEPTION 'manager investment accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$BEGIN PERFORM test_dashboard_no_private(crm_dashboard_work('branches'));BEGIN PERFORM crm_dashboard_work('investment');RAISE EXCEPTION 'viewer investment accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
SELECT set_config('test.actor',test_id(15)::text,false);
DO $$BEGIN BEGIN PERFORM crm_dashboard_work('branches');RAISE EXCEPTION 'inactive accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
SELECT set_config('test.actor',test_id(16)::text,false);
DO $$DECLARE x jsonb:=crm_dashboard_work('investment');BEGIN PERFORM test_assert(x::text NOT LIKE '%'||test_id(102)::text||'%' AND x::text NOT LIKE '%'||test_id(206)::text||'%','foreign company data leaked');END$$;
SELECT set_config('test.actor','',false);
DO $$BEGIN BEGIN PERFORM crm_dashboard_work('branches');RAISE EXCEPTION 'missing actor accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
RESET ROLE;
ROLLBACK;
