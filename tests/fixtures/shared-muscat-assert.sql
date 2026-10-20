-- ISOLATED SYNTHETIC DATABASE ONLY. Real production catalog/constraints/RLS,
-- with the fixture's test.actor JWT adapter; no provider call or real records.
BEGIN;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_shared32 WHERE key='business_before'),
 'SQL32 and repeat application preserve every original business row');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p)=(SELECT value FROM test_shared32 WHERE key='profiles_before'),
 'SQL32 does not retire or rename an account as a schema side effect');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY company_id,route_key) FROM whatsapp_route_credentials r) IS NOT DISTINCT FROM (SELECT value FROM test_shared32 WHERE key='credentials_before'),
 'SQL32 leaves every encrypted route credential unchanged');
SELECT test_reservation_assert((SELECT bool_and(to_jsonb(r)-'transport_route_key'=prior) FROM company_lead_routes r,
 LATERAL (SELECT value prior FROM jsonb_array_elements((SELECT value FROM test_shared32 WHERE key='routes_before')) WHERE value->>'id'=r.id::text)s WHERE r.route_key<>'investment'),
 'both real physical route configurations retain all prior fields');
SELECT test_reservation_assert((SELECT transport_route_key='muscat' AND whatsapp_number IS NULL AND meta_phone_number_id IS NULL
 AND meta_waba_id IS NULL AND owner_only_inbox IS TRUE AND assigned_to=test_id(10) FROM company_lead_routes WHERE id=test_id(22)),
 'investment is an owner-private alias and no longer owns a separate reception number');
SELECT test_reservation_assert((SELECT before_data-'transport_route_key'=value FROM crm_repair_private.audit32_route_backup,
 LATERAL (SELECT value FROM jsonb_array_elements((SELECT value FROM test_shared32 WHERE key='routes_before')) WHERE value->>'id'=test_id(22)::text)s
 WHERE company_id=test_id(1) AND route_key='investment'),
 'exact retired route configuration remains in the restricted recovery journal');
SELECT test_reservation_assert(NOT has_function_privilege('authenticated','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE'),
 'business resolver is a backend API and not a private-client existence oracle');
DO $$BEGIN
 BEGIN UPDATE company_lead_routes SET whatsapp_number='+96890000909' WHERE id=test_id(22);RAISE EXCEPTION 'retired independent phone accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE company_lead_routes SET meta_phone_number_id='another-meta-id' WHERE id=test_id(22);RAISE EXCEPTION 'independent Meta binding accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE company_lead_routes SET transport_route_key='barka' WHERE id=test_id(22);RAISE EXCEPTION 'private alias redirected across branches';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE company_lead_routes SET transport_route_key='muscat' WHERE id=test_id(21);RAISE EXCEPTION 'ordinary branch alias accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;

-- Existing ordinary shared identity (106) has an explicit private request (206).
-- Legacy is_investor/old investor request labels on 103/104 remain ordinary.
SELECT set_config('test.actor','',false);
SET ROLE service_role;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone,unread_count)
VALUES
 (test_id(39000),test_id(1),test_id(106),test_id(11),'muscat','synthetic-muscat','96891100106','+96891100106',0),
 (test_id(39001),test_id(1),test_id(102),test_id(11),'muscat','synthetic-muscat','96891100102','+96891100102',0),
 (test_id(39002),test_id(1),test_id(103),test_id(11),'muscat','synthetic-muscat','96891100103','+96891100103',0),
 (test_id(39003),test_id(1),test_id(104),test_id(12),'barka','synthetic-barka','96891100104','+96891100104',0),
 (test_id(39004),test_id(1),NULL,test_id(11),'muscat','synthetic-muscat','96891139004','+96891139004',0);
SELECT test_reservation_assert((SELECT bool_and(route_key='investment' AND assigned_to=test_id(10) AND meta_phone_number_id='synthetic-muscat') FROM whatsapp_conversations WHERE id IN(test_id(39000),test_id(39001))),
 'known private client and explicit private request protect new Muscat conversations before messages exist');
SELECT test_reservation_assert((SELECT route_key='muscat' FROM whatsapp_conversations WHERE id=test_id(39002))
 AND (SELECT route_key='barka' FROM whatsapp_conversations WHERE id=test_id(39003))
 AND (SELECT route_key='muscat' FROM whatsapp_conversations WHERE id=test_id(39004)),
 'legacy investor labels and unknown first contacts do not invent private classification');
SELECT test_reservation_assert(crm_resolve_whatsapp_business_route(test_id(1),'muscat','٩١١٠٠١٠٦',test_id(39000))->>'route_key'='investment'
 AND crm_resolve_whatsapp_business_route(test_id(1),'muscat','0096891100106',test_id(39000))->>'transport_route_key'='muscat',
 'Arabic and international phone variants resolve canonical private identity on the same physical line');
SELECT test_reservation_assert(crm_resolve_whatsapp_business_route(test_id(1),'barka','+96891100102',test_id(403))->>'route_key'='investment'
 AND crm_resolve_whatsapp_business_route(test_id(1),'barka','+96891100102',test_id(403))->>'transport_route_key'='barka',
 'private parent stays private on historical Barka transport without pretending that transport is Muscat');
SELECT test_reservation_assert((SELECT route_key='muscat' FROM resolve_whatsapp_route(test_id(1),'synthetic-muscat')),
 'physical route resolver still maps Muscat Meta ID to exactly Muscat');
DO $$BEGIN
 BEGIN PERFORM crm_resolve_whatsapp_business_route(test_id(2),'muscat','+96891100106',test_id(39000));RAISE EXCEPTION 'foreign conversation accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_resolve_whatsapp_business_route(test_id(1),'barka','+96891100106',test_id(39000));RAISE EXCEPTION 'wrong physical context accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_resolve_whatsapp_business_route(test_id(1),'muscat','+96891100100',test_id(39000));RAISE EXCEPTION 'wrong phone context accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END$$;
UPDATE whatsapp_conversations SET route_key='muscat',assigned_to=test_id(11) WHERE id=test_id(39000);
SELECT test_reservation_assert((SELECT route_key='investment' AND assigned_to=test_id(10) FROM whatsapp_conversations WHERE id=test_id(39000)),
 'stale webhook update cannot downgrade a previously private conversation');

INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,channel_source)
VALUES(test_id(39010),test_id(1),test_id(39000),test_id(106),'wamid.synthetic.shared-muscat-private','inbound','PRIVATE SHARED MUSCAT SENTINEL','2026-10-20 10:00+04','customer','whatsapp');
INSERT INTO test_shared32 SELECT 'private_counter',to_jsonb(c) FROM whatsapp_conversations c WHERE id=test_id(39000);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,channel_source)
VALUES(test_id(39011),test_id(1),test_id(39000),test_id(106),'wamid.synthetic.shared-muscat-private','inbound','PRIVATE SHARED MUSCAT SENTINEL','2026-10-20 10:00+04','customer','whatsapp') ON CONFLICT(whatsapp_message_id) DO NOTHING;
SELECT test_reservation_assert((SELECT unread_count=(SELECT (value->>'unread_count')::int FROM test_shared32 WHERE key='private_counter')
 AND last_message_at=(SELECT (value->>'last_message_at')::timestamptz FROM test_shared32 WHERE key='private_counter') FROM whatsapp_conversations WHERE id=test_id(39000)),
 'replayed provider message increments neither private unread count nor latest timestamp');
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,channel_source)
VALUES(test_id(39012),test_id(1),test_id(39000),test_id(106),'wamid.synthetic.shared-muscat-late','inbound','PRIVATE LATE SENTINEL','2026-10-19 10:00+04','customer','whatsapp');
SELECT test_reservation_assert((SELECT last_message_at='2026-10-20 10:00+04'::timestamptz FROM whatsapp_conversations WHERE id=test_id(39000)),
 'late private message does not move the latest conversation time backward');
INSERT INTO activities(id,company_id,user_id,client_id,type,description,actor_type,direction,channel,occurred_at,after_data)
VALUES(test_id(39010),test_id(1),test_id(11),test_id(106),'note','PRIVATE INBOUND ACTIVITY','system','inbound','whatsapp','2026-10-20 10:00+04',
 jsonb_build_object('conversation_id',test_id(39000),'message_id',test_id(39010),'source_actor_type','customer')),
 (test_id(39020),test_id(1),test_id(11),test_id(106),'note','PRIVATE MESSAGE-ONLY ACTIVITY','system','inbound','whatsapp','2026-10-20 10:00+04',jsonb_build_object('message_id',test_id(39010)));
RESET ROLE;
SELECT test_reservation_assert((SELECT lead_route='muscat' AND assigned_to=test_id(11) FROM clients WHERE id=test_id(106)),
 'private inbound preserves the existing ordinary parent identity and responsibility');

-- Real role policies: private thread/message/provenance-bearing activity stay
-- owner-only even when stale assigned_to/user_id identifies an active employee.
CREATE FUNCTION test_shared32_private_hidden() RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id IN(test_id(39000),test_id(39001))),'shared Muscat private conversation leak');
 PERFORM test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id IN(test_id(39010),test_id(39012))),'shared Muscat private message leak');
 PERFORM test_reservation_assert(NOT EXISTS(SELECT 1 FROM activities WHERE id IN(test_id(39010),test_id(39020))),'private activity on ordinary parent leaked');
 PERFORM test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_whatsapp_latest_messages(ARRAY[test_id(39000),test_id(39001)])),'shared private latest-message RPC leak');
 BEGIN PERFORM crm_resolve_whatsapp_business_route(test_id(1),'muscat','+96891100106',test_id(39000));RAISE EXCEPTION 'private resolver exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_shared32_private_hidden();
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(39002)) AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(39003)),
 'Muscat employee retains ordinary Muscat only');
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_shared32_private_hidden();
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(39003)) AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(39002)),
 'Barka employee retains ordinary Barka only');
SELECT set_config('test.actor',test_id(13)::text,false);SELECT test_shared32_private_hidden();
SELECT set_config('test.actor',test_id(14)::text,false);SELECT test_shared32_private_hidden();
SELECT set_config('test.actor',test_id(15)::text,false);SELECT test_shared32_private_hidden();
SELECT set_config('test.actor',test_id(16)::text,false);SELECT test_shared32_private_hidden();
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT count(*)=2 FROM whatsapp_conversations WHERE id IN(test_id(39000),test_id(39001)))
 AND (SELECT count(*)=2 FROM whatsapp_messages WHERE id IN(test_id(39010),test_id(39012)))
 AND (SELECT count(*)=2 FROM activities WHERE id IN(test_id(39010),test_id(39020))),
 'owner positive control reads the exact private records hidden from every other role');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);

-- Classification after a thread exists must protect the same physical thread.
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type)
VALUES(test_id(39100),test_id(1),test_id(11),'Synthetic prospective private classification','+96891139100','muscat','buyer');
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone,unread_count)
VALUES(test_id(39101),test_id(1),test_id(39100),test_id(11),'muscat','synthetic-muscat','96891139100','+96891139100',0);
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,created_by)
VALUES(test_id(39102),test_id(1),test_id(39100),'investor','investment','investment',test_id(10),test_id(10));
SELECT test_reservation_assert((SELECT route_key='investment' AND assigned_to=test_id(10) FROM whatsapp_conversations WHERE id=test_id(39101)),
 'owner canonical request classification makes the existing Muscat thread private in the same transaction');
-- A stale producer retains its old physical route after the owner's decision.
SELECT set_config('test.actor','',false);
SET ROLE service_role;
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp)
VALUES(test_id(39103),test_id(1),test_id(39101),test_id(39100),'wamid.synthetic.classified-before-insert','inbound','PRIVATE CLASSIFIED AFTER THREAD','2026-10-20 11:00+04');
SELECT test_reservation_assert((SELECT route_key='investment' AND assigned_to=test_id(10) FROM whatsapp_conversations WHERE id=test_id(39101)),
 'message persistence re-evaluates a newly private request on an older ordinary thread');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
UPDATE client_requests SET status='cancelled' WHERE id=test_id(39102);
SELECT set_config('test.actor','',false);
SET ROLE service_role;
UPDATE whatsapp_conversations SET route_key='muscat',assigned_to=test_id(11) WHERE id=test_id(39101);
SELECT test_reservation_assert((SELECT route_key='investment' FROM whatsapp_conversations WHERE id=test_id(39101)),
 'cancelling a private request does not disclose its retained conversation');

-- A webhook can retain ordinary AI output while the owner makes the thread
-- private. Execute the actual deployed batch/core RPC, not a modeled handler:
-- its attempted request write and all derived summaries must roll back together.
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,status,budget_min)
VALUES(test_id(39500),test_id(1),test_id(106),'buyer','muscat','muscat',test_id(11),'active',120000),
 (test_id(39501),test_id(1),test_id(106),'buyer','muscat','muscat',test_id(11),'active',140000);
RESET ROLE;
INSERT INTO test_shared32 VALUES('before_stale_batch',test_coherence28_business());
SET ROLE service_role;
-- Existing request geography already canonicalizes a newly created request
-- from its origin message. Prove that path is private, then discard test work.
SAVEPOINT private_create_check;
DO $$DECLARE result_ jsonb;request_id_ uuid;BEGIN
 result_:=apply_whatsapp_request_batch_guarded(test_id(1),test_id(106),test_id(11),'muscat','+96890000001',test_id(39010),
  jsonb_build_array(jsonb_build_object('action','create','request_type','buyer','fields_present',jsonb_build_array('budget'),'budget_min',987654,'confidence',1)),
  '2026-10-20 10:00+04');
 request_id_:=(result_->>'linked_request_id')::uuid;
 PERFORM test_reservation_assert((result_->>'applied_count')::int=1 AND EXISTS(SELECT 1 FROM client_requests
  WHERE id=request_id_ AND route_key='investment' AND branch_key='investment' AND assigned_to=test_id(10)),
  'stale create uses persisted origin-message privacy and never creates an ordinary request');
 PERFORM test_reservation_assert((SELECT lead_route='muscat' AND assigned_to=test_id(11) AND budget_min IS DISTINCT FROM 987654
  FROM clients WHERE id=test_id(106)),'canonical private create leaves the ordinary parent summary free of private request data');
END$$;
ROLLBACK TO SAVEPOINT private_create_check;
RELEASE SAVEPOINT private_create_check;
DO $$DECLARE payload jsonb;BEGIN
 FOR payload IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   jsonb_build_array(jsonb_build_object('action','update','existing_request_id',test_id(39500),'fields_present',jsonb_build_array('budget'),'budget_min',987654,'confidence',1)),
   jsonb_build_array(jsonb_build_object('action','create','request_type','buyer','fields_present',jsonb_build_array('budget'),'budget_min',987654,'confidence',1),
     jsonb_build_object('action','update','existing_request_id',test_id(39501),'fields_present',jsonb_build_array('budget'),'budget_min',987655,'confidence',1))))
 LOOP
  BEGIN
   PERFORM apply_whatsapp_request_batch_guarded(test_id(1),test_id(106),test_id(11),'muscat','+96890000001',test_id(39010),payload,'2026-10-20 10:00+04');
   RAISE EXCEPTION 'stale ordinary update accepted a private message';
  EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'whatsapp_request_route_compartment_mismatch' THEN RAISE;END IF;
  END;
 END LOOP;
 BEGIN UPDATE whatsapp_messages SET request_id=test_id(39500) WHERE id=test_id(39010);
  RAISE EXCEPTION 'direct private message linked to public request';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'whatsapp_request_route_compartment_mismatch' THEN RAISE;END IF;END;
 BEGIN INSERT INTO whatsapp_message_requests(company_id,message_id,request_id)
  VALUES(test_id(1),test_id(39010),test_id(39500));RAISE EXCEPTION 'direct public request link accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'whatsapp_request_route_compartment_mismatch' THEN RAISE;END IF;END;
END$$;
RESET ROLE;
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_shared32 WHERE key='before_stale_batch'),
 'stale AI update/multi-request and direct-link failures atomically preserve every request, client summary, message, link and event, including an earlier valid create in the failed batch');
SET ROLE service_role;
INSERT INTO whatsapp_message_requests(company_id,message_id,request_id) VALUES(test_id(1),test_id(39010),test_id(206))
 ON CONFLICT(message_id,request_id) DO NOTHING;
INSERT INTO whatsapp_message_requests(company_id,message_id,request_id) VALUES(test_id(1),test_id(39010),test_id(206))
 ON CONFLICT(message_id,request_id) DO NOTHING;
SELECT test_reservation_assert((SELECT count(*)=1 FROM whatsapp_message_requests WHERE message_id=test_id(39010)),
 'valid canonical private request link remains idempotent on replay');
UPDATE whatsapp_messages SET request_id=test_id(206) WHERE id=test_id(39010);
SELECT test_reservation_assert((SELECT request_id=test_id(206) FROM whatsapp_messages WHERE id=test_id(39010)),
 'valid private message request association still succeeds');
RESET ROLE;
ROLLBACK;
