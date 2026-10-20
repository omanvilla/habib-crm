-- Isolated only, after actual retirement. Reproduce the captured predecessor,
-- then exercise the fixed public RPC with real authenticated-role RLS/triggers.
-- Every viewing/request/activity/idempotency change below is rolled back.
BEGIN;
RESET ROLE;
DO $$DECLARE prior text;BEGIN
 SELECT definition INTO STRICT prior FROM crm_repair_private.audit31_catalog_backup
  WHERE identity='public.crm_save_viewing_atomic(jsonb,uuid)' AND kind='existing_function';
 EXECUTE prior;
END $$;
SELECT set_config('test.actor',test_id(10)::text,true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN
  PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(600),'expected_version',
   (SELECT row_version FROM viewings WHERE id=test_id(600)),'time_unknown',true,'notes','Synthetic historical owner correction'),test_id(37120));
  RAISE EXCEPTION 'predecessor unexpectedly permits the retired historical author';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'viewing_agent_not_allowed' THEN RAISE;END IF;
 END;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('test.actor',test_id(10)::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO test_retirement32 VALUES('viewing_payload',jsonb_build_object('id',test_id(600),'expected_version',
 (SELECT row_version FROM viewings WHERE id=test_id(600)),'time_unknown',true,'notes','Synthetic historical owner correction'));
INSERT INTO test_retirement32 SELECT 'viewing_saved',crm_save_viewing_atomic(value,test_id(37121)) FROM test_retirement32 WHERE key='viewing_payload';
SELECT test_reservation_assert((SELECT (value->>'ok')::boolean AND NOT (value->>'replayed')::boolean
 AND value#>>'{viewing,id}'=test_id(600)::text AND value#>>'{viewing,agent_id}'=test_id(11)::text
 AND value#>>'{viewing,created_by}'=test_id(11)::text AND value#>>'{viewing,request_id}'=test_id(200)::text
 AND value#>>'{viewing,notes}'='Synthetic historical owner correction' FROM test_retirement32 WHERE key='viewing_saved'),
 'owner edits an existing retired-author visit while preserving author, creator and request');
SELECT test_reservation_assert((SELECT (crm_save_viewing_atomic(value,test_id(37121))->>'replayed')::boolean
 FROM test_retirement32 WHERE key='viewing_payload'),'historical viewing retry acknowledges one saved operation');
DO $$BEGIN
 BEGIN PERFORM crm_save_viewing_atomic((SELECT value FROM test_retirement32 WHERE key='viewing_payload'),test_id(37122));
  RAISE EXCEPTION 'stale historical edit accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(601),'agent_id',test_id(11),
   'expected_version',(SELECT row_version FROM viewings WHERE id=test_id(601)),'time_unknown',true),test_id(37123));
  RAISE EXCEPTION 'changing to a retired assignee accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'viewing_agent_not_allowed' THEN RAISE;END IF;END;
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('client_id',test_id(100),'property_id',test_id(300),'request_id',test_id(200),
   'agent_id',test_id(11),'viewing_date','2026-12-15','viewing_time','14:00','status','scheduled'),test_id(37124));
  RAISE EXCEPTION 'new visit assigned to retired user accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'viewing_agent_not_allowed' THEN RAISE;END IF;END;
END $$;
SELECT set_config('test.actor',test_id(13)::text,true);
SELECT test_reservation_assert((crm_save_viewing_atomic(jsonb_build_object('id',test_id(600),'expected_version',
 (SELECT row_version FROM viewings WHERE id=test_id(600)),'time_unknown',true,'notes','Synthetic historical manager correction'),test_id(37125))#>>'{viewing,agent_id}')=test_id(11)::text,
 'authorized manager may also retain the unchanged retired historical author');
DO $$BEGIN
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(602),'expected_version',1,'time_unknown',true),test_id(37126));
  RAISE EXCEPTION 'manager accessed private historical visit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(12)::text,true);
SELECT test_reservation_assert((crm_save_viewing_atomic(jsonb_build_object('id',test_id(601),'expected_version',
 (SELECT row_version FROM viewings WHERE id=test_id(601)),'time_unknown',true,'notes','Synthetic Barka own visit correction'),test_id(37127))#>>'{viewing,agent_id}')=test_id(12)::text,
 'the retained active agent still edits her own branch visit');
DO $$BEGIN
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(600),'expected_version',1,'time_unknown',true),test_id(37128));
  RAISE EXCEPTION 'Barka agent accessed Muscat historical visit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(601),'agent_id',test_id(11),
   'expected_version',(SELECT row_version FROM viewings WHERE id=test_id(601)),'time_unknown',true),test_id(37129));
  RAISE EXCEPTION 'agent changed historical visit to another assignee';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(16)::text,true);
DO $$BEGIN
 BEGIN PERFORM crm_save_viewing_atomic(jsonb_build_object('id',test_id(600),'expected_version',1,'time_unknown',true),test_id(37130));
  RAISE EXCEPTION 'foreign owner accessed historical visit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
ROLLBACK;
SELECT 'Retired-author viewing reproduction and corrected authorized workflow passed' result;
