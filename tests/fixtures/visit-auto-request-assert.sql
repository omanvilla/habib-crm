-- Run after fixture + SQL13. All records are synthetic and the database is disposable.
CREATE FUNCTION test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION test_visit(c int,p int,extra jsonb DEFAULT '{}',op uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.crm_save_viewing_atomic(jsonb_build_object('client_id',test_id(c),'property_id',test_id(p),'viewing_date','2026-10-02','viewing_time','10:00','status','scheduled')||extra,op)
$$;
GRANT EXECUTE ON FUNCTION test_id(int),test_visit(int,int,jsonb,uuid) TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
DO $$DECLARE a jsonb;b jsonb;v uuid;r uuid;n int;BEGIN
 a:=test_visit(201,101,'{"location":"TEST LEGACY ADDRESS","followup_date":"2026-10-03","next_step":"TEST NEXT"}',test_id(901));
 v:=(a->>'viewing_id')::uuid;r:=(a->'viewing'->>'request_id')::uuid;
 IF r IS NULL OR a->>'ok'<>'true' THEN RAISE EXCEPTION 'automatic request missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=r AND subject_property_id=test_id(101) AND request_type='buyer' AND branch_key='muscat' AND budget_max IS NULL) THEN RAISE EXCEPTION 'automatic request wrong facts';END IF;
 IF NOT EXISTS(SELECT 1 FROM property_inquiries WHERE request_id=r AND has_inbound_inquiry=false) THEN RAISE EXCEPTION 'visit incorrectly counted inbound';END IF;
 IF (SELECT count(*) FROM tasks WHERE viewing_id=v)<>1 THEN RAISE EXCEPTION 'followup missing';END IF;
 b:=test_visit(201,101,'{"location":"TEST LEGACY ADDRESS","followup_date":"2026-10-03","next_step":"TEST NEXT"}',test_id(901));
 IF b->>'replayed'<>'true' OR b->>'viewing_id'<>a->>'viewing_id' THEN RAISE EXCEPTION 'retry duplicated visit';END IF;
 b:=test_visit(201,101);IF b->'viewing'->>'request_id'<>r::text THEN RAISE EXCEPTION 'separate operation duplicated request';END IF;
 b:=test_visit(201,101,jsonb_build_object('id',v,'expected_version',1,'status','done','pipeline_outcome','lost','rejection_reason','price'));
 IF b->'viewing'->>'location'<>'TEST LEGACY ADDRESS' OR b->'viewing'->>'row_version'<>'2' THEN RAISE EXCEPTION 'legacy location/version lost';END IF;
 IF (b->'viewing'->>'outcome_note') IS NOT NULL THEN RAISE EXCEPTION 'customer words fabricated';END IF;
 BEGIN PERFORM test_visit(201,101,jsonb_build_object('id',v,'expected_version',1));RAISE EXCEPTION 'stale version accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM test_visit(201,101,'{"status":"done","pipeline_outcome":"lost"}');RAISE EXCEPTION 'missing primaryreason accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM test_visit(201,101,'{"viewing_time":null}');RAISE EXCEPTION 'scheduled unknown time accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 n:=(SELECT count(*) FROM viewings);
 BEGIN PERFORM test_visit(201,102);RAISE EXCEPTION 'crossbranch property accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM test_visit(202,101);RAISE EXCEPTION 'crossbranch client accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF n<>(SELECT count(*) FROM viewings) THEN RAISE EXCEPTION 'denied operation left visit';END IF;
 BEGIN PERFORM test_visit(201,101,jsonb_build_object('request_id',r,'request_type','tenant'));RAISE EXCEPTION 'wrong type request accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 b:=test_visit(201,101,'{"request_type":"tenant"}');
 IF b->'viewing'->>'request_id'=r::text THEN RAISE EXCEPTION 'tenant merged into buyer';END IF;
 IF NOT EXISTS(SELECT 1 FROM property_inquiries WHERE request_id=(b->'viewing'->>'request_id')::uuid AND NOT viewing_completed AND NOT has_inbound_inquiry) THEN RAISE EXCEPTION 'tenant interest inherited buyer visit';END IF;
 IF (SELECT count(*) FROM client_requests WHERE subject_property_id=test_id(101) AND client_id=test_id(201))<>2 THEN RAISE EXCEPTION 'unexpected exact requests';END IF;
END$$;
-- Unknown time is explicitly marked and creates no fictional appointment or negotiation date.
DO $$DECLARE a jsonb;BEGIN
 a:=test_visit(201,103,'{"viewing_time":null,"time_unknown":true,"status":"done","pipeline_outcome":null}');
 IF a->>'appointment_id' IS NOT NULL OR a->'viewing'->>'viewing_time' IS NOT NULL OR a->'viewing'->>'pipeline_outcome' IS NOT NULL THEN RAISE EXCEPTION 'dateonly visit fabricated time/outcome';END IF;
 IF NOT EXISTS(SELECT 1 FROM property_inquiries WHERE property_id=test_id(103) AND viewing_completed AND NOT has_inbound_inquiry) THEN RAISE EXCEPTION 'dateonly visit missing real attendance';END IF;
 a:=test_visit(201,103,jsonb_build_object('id',a->>'viewing_id','expected_version',1,'viewing_time',NULL,'time_unknown',true,'status','done','pipeline_outcome',NULL,'notes','TEST DATEONLY EDIT'));
 IF a->>'appointment_id' IS NOT NULL OR a->'viewing'->>'notes'<>'TEST DATEONLY EDIT' THEN RAISE EXCEPTION 'dateonly edit lost unknown time';END IF;
END$$;
RESET ROLE;
-- More synthetic clients for independent matching cases.
INSERT INTO clients(id,company_id,name,phone,assigned_to,lead_route)
SELECT test_id(n),test_id(1),'TEST MATCH '||n,'+9689'||lpad(n::text,7,'0'),test_id(2),'muscat' FROM generate_series(211,216)n;
INSERT INTO client_requests(id,company_id,client_id,request_type,subject_property_id,branch_key,route_key,assigned_to,property_type,preferred_area,budget_max,bedrooms_min)
VALUES(test_id(411),test_id(1),test_id(211),'buyer',NULL,'muscat','muscat',test_id(2),'villa','TEST MUSCAT AREA',120000,NULL),
(test_id(412),test_id(1),test_id(212),'buyer',NULL,'muscat','muscat',test_id(2),'villa','TEST MUSCAT AREA',80000,NULL),
(test_id(413),test_id(1),test_id(213),'buyer',NULL,'muscat','muscat',test_id(2),'villa','TEST MUSCAT AREA',NULL,5),
(test_id(414),test_id(1),test_id(214),'buyer',NULL,'muscat','muscat',test_id(2),'villa','TEST MUSCAT AREA',NULL,NULL),
(test_id(415),test_id(1),test_id(214),'buyer',NULL,'muscat','muscat',test_id(2),'villa','TEST MUSCAT AREA',NULL,NULL),
(test_id(416),test_id(1),test_id(215),'buyer',NULL,'barka','barka',test_id(3),'villa','TEST MUSCAT AREA',NULL,NULL);
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
DO $$DECLARE a jsonb;n int;BEGIN
 a:=test_visit(211,101);IF a->'viewing'->>'request_id'<>test_id(411)::text THEN RAISE EXCEPTION 'unique compatible request not reused';END IF;
 a:=test_visit(212,101);IF a->'viewing'->>'request_id'=test_id(412)::text THEN RAISE EXCEPTION 'incompatible budget reused';END IF;
 a:=test_visit(213,101);IF a->'viewing'->>'request_id'=test_id(413)::text THEN RAISE EXCEPTION 'unproven bedroom requirement reused';END IF;
 a:=test_visit(214,101);IF a->'viewing'->>'request_id' IN(test_id(414)::text,test_id(415)::text) THEN RAISE EXCEPTION 'ambiguous general request guessed';END IF;
 IF (SELECT count(*) FROM client_requests WHERE client_id=test_id(214) AND subject_property_id IS NULL)<>2 THEN RAISE EXCEPTION 'independent requests changed';END IF;
 a:=test_visit(215,101);IF a->'viewing'->>'request_id'=test_id(416)::text THEN RAISE EXCEPTION 'hidden branch request reused';END IF;
 BEGIN PERFORM test_visit(216,101,jsonb_build_object('agent_id',test_id(3)));RAISE EXCEPTION 'wrong agent accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF EXISTS(SELECT 1 FROM client_requests WHERE client_id=test_id(216)) THEN RAISE EXCEPTION 'post-create failure left orphan request';END IF;
END$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
DO $$DECLARE a jsonb;BEGIN
 a:=test_visit(202,102);IF a->>'ok'<>'true' THEN RAISE EXCEPTION 'Barka employee save failed';END IF;
 IF EXISTS(SELECT 1 FROM viewings WHERE property_id=test_id(101)) THEN RAISE EXCEPTION 'Barka sees Muscat visits';END IF;
END$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
DO $$DECLARE a jsonb;BEGIN
 a:=test_visit(202,102);IF a->>'ok'<>'true' THEN RAISE EXCEPTION 'owner crossbranch save failed';END IF;
 IF (SELECT count(*) FROM client_requests WHERE client_id=test_id(202) AND subject_property_id=test_id(102))<>1 THEN RAISE EXCEPTION 'owner retry duplicated employee request';END IF;
END$$;
RESET ROLE;
-- All denied statements rolled back atomically, leaving exactly one operation per persisted visit or edit.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM appointments a LEFT JOIN viewings v ON v.appointment_id=a.id WHERE v.id IS NULL) THEN RAISE EXCEPTION 'orphan appointment';END IF;
 IF EXISTS(SELECT 1 FROM client_requests r WHERE r.source='viewing' AND NOT EXISTS(SELECT 1 FROM viewings v WHERE v.request_id=r.id)) THEN RAISE EXCEPTION 'orphan auto request';END IF;
END$$;
SELECT 'visit automatic request / roles / retry / reasons / date-only assertions passed' AS result;
