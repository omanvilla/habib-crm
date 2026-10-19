-- Synthetic full catalog only. Apply SQL25/26/27/28/29 first.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_followup29(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_followup29 TO authenticated;
INSERT INTO public.clients(id,company_id,assigned_to,name,phone,lead_route,last_contact_at,human_contact_at)
VALUES(test_id(29000),test_id(1),test_id(11),'Synthetic follow-up Muscat','+96800029000','muscat','2024-08-20','2024-08-20'),
 (test_id(29001),test_id(1),test_id(12),'Synthetic follow-up Barka','+96800029001','barka','2024-08-20','2024-08-20');
INSERT INTO public.properties(id,company_id,added_by,title,type,area,price,branch_key,status)
VALUES(test_id(29010),test_id(1),test_id(10),'Synthetic follow-up property','villa','Synthetic Muscat',80000,'muscat','available'),
 (test_id(29011),test_id(1),test_id(10),'Synthetic other branch property','villa','Synthetic Barka',80000,'barka','available'),
 (test_id(29012),test_id(1),test_id(10),'Synthetic independent property','villa','Synthetic Muscat',80000,'muscat','available');
INSERT INTO public.client_requests(id,company_id,client_id,assigned_to,request_type,route_key,branch_key,subject_property_id,status,next_followup,followup_note,next_action,preferred_area,wilayat)
VALUES(test_id(29020),test_id(1),test_id(29000),test_id(11),'buyer','muscat','muscat',test_id(29010),'active','2024-08-21','Synthetic previous note','Synthetic prior action','الخوض','السيب'),
 (test_id(29021),test_id(1),test_id(29000),test_id(11),'buyer','muscat','muscat',test_id(29012),'active','2024-08-22','Synthetic independent note','Synthetic independent action','الخوض','السيب'),
 (test_id(29022),test_id(1),test_id(29001),test_id(12),'buyer','barka','barka',test_id(29011),'active','2024-08-23','Synthetic Barka note','Synthetic Barka action','بركاء','بركاء');
INSERT INTO public.property_inquiries(id,company_id,client_id,property_id,request_id,assigned_to,status,source,first_inquiry_at,last_inquiry_at,last_contact_at,followup_note,next_followup)
VALUES(test_id(29030),test_id(1),test_id(29000),test_id(29010),test_id(29020),test_id(11),'inquiry','whatsapp','2024-08-20T08:00:00Z','2024-08-21T09:00:00Z','2024-08-22T10:00:00Z','Synthetic previous note','2024-08-23'),
 (test_id(29031),test_id(1),test_id(29001),test_id(29011),test_id(29022),test_id(12),'inquiry','other','2024-08-20','2024-08-21','2024-08-22','Synthetic Barka note','2024-08-23'),
 (test_id(29032),test_id(1),test_id(29000),test_id(29012),test_id(29021),test_id(11),'negotiation','other','2024-08-20','2024-08-21','2024-08-22','Synthetic legacy negotiation note','2024-08-23');
-- This legacy negotiation has unknown milestone dates. A new follow-up must
-- not manufacture its old negotiation/opportunity date.
UPDATE public.client_requests SET negotiation_started_at=NULL,opportunity_opened_at=NULL WHERE id=test_id(29021);
INSERT INTO test_followup29 VALUES
 ('inbound_before',(SELECT jsonb_build_object('first',first_inquiry_at,'last',last_inquiry_at,'count',inquiry_count,'source',source,'has_inbound',has_inbound_inquiry) FROM property_inquiries WHERE id=test_id(29030))),
 ('independent_before',(SELECT to_jsonb(r) FROM client_requests r WHERE id=test_id(29021))),
 ('deal_before',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM deals d)),
 ('viewing_before',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb) FROM viewings v)),
 ('catalog_before',(SELECT jsonb_agg(jsonb_build_object('identity',identity,'definition',definition) ORDER BY identity) FROM crm_repair_private.audit29_catalog_backup)),
 ('private_parent_before',(SELECT to_jsonb(c) FROM clients c WHERE id=test_id(106))),
 ('private_payload',(SELECT jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status',status,'outcome','Synthetic private follow-up sentinel','next_followup',current_date+1) FROM property_inquiries WHERE id=test_id(1403)));
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,false);
INSERT INTO test_followup29 VALUES('target_before',crm_employee_target_snapshot());
INSERT INTO test_followup29 VALUES('performance_before',crm_employee_performance(date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,(now() AT TIME ZONE 'Asia/Muscat')::date+1));
INSERT INTO test_followup29 SELECT 'human_payload',jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','followup',
 'outcome','Synthetic attempt: customer requested a later call','next_action','Synthetic next call','next_followup',current_date+1,'reason_id',NULL,'reason_phase','unknown') FROM property_inquiries WHERE id=test_id(29030);
INSERT INTO test_followup29 SELECT 'human_result',crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='human_payload'),test_id(29050));
SELECT test_reservation_assert((SELECT value->>'inquiry_id'=test_id(29030)::text AND (value->>'contact_recorded')::boolean FROM test_followup29 WHERE key='human_result'),'SQL29 acknowledges exactly the saved inquiry and real outcome');
SELECT test_reservation_assert((crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='human_payload'),test_id(29050))->>'replayed')::boolean,'SQL29 lost-response replay returns the same event');
SELECT test_reservation_assert((SELECT count(*)=1 FROM activities WHERE id=test_id(29050)),'SQL29 replay creates exactly one activity');
SELECT test_reservation_assert((SELECT actor_type='human' AND type='followup' AND outcome='Synthetic attempt: customer requested a later call' AND client_id=test_id(29000) AND property_id=test_id(29010) AND request_id=test_id(29020) AND occurred_at IS NOT NULL FROM activities WHERE id=test_id(29050)),'SQL29 event carries actual human outcome and exact journey links');
SELECT test_reservation_assert((SELECT jsonb_build_object('first',first_inquiry_at,'last',last_inquiry_at,'count',inquiry_count,'source',source,'has_inbound',has_inbound_inquiry) FROM property_inquiries WHERE id=test_id(29030))=(SELECT value FROM test_followup29 WHERE key='inbound_before'),'SQL29 follow-up preserves inbound first/last dates, counts and provenance');
SELECT test_reservation_assert((SELECT cl.last_contact_at=a.occurred_at AND cl.human_contact_at=a.occurred_at AND rq.last_contact_at=a.occurred_at AND rq.next_followup=current_date+1 AND rq.next_action='Synthetic next call' FROM clients cl JOIN client_requests rq ON rq.client_id=cl.id JOIN activities a ON a.client_id=cl.id AND a.request_id=rq.id WHERE a.id=test_id(29050)),'SQL29 client/request contact dates and next action agree with the recorded event');
SELECT test_reservation_assert((SELECT to_jsonb(r) FROM client_requests r WHERE id=test_id(29021))=(SELECT value FROM test_followup29 WHERE key='independent_before'),'SQL29 leaves independent client requests unchanged');
INSERT INTO test_followup29 SELECT 'blank_payload',jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','followup','outcome',NULL,'next_action',NULL,'next_followup',current_date+2,'reason_id',NULL,'reason_phase','unknown') FROM property_inquiries WHERE id=test_id(29030);
SELECT crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='blank_payload'),test_id(29051));
SELECT test_reservation_assert((SELECT outcome IS NULL AND type='system' AND channel='system' FROM activities WHERE id=test_id(29051)),'SQL29 blank-outcome administrative save earns no contact credit');
SELECT test_reservation_assert((SELECT followup_note='Synthetic attempt: customer requested a later call' AND last_contact_at=(SELECT occurred_at FROM activities WHERE id=test_id(29050)) FROM property_inquiries WHERE id=test_id(29030)),'SQL29 administrative edit preserves previous note and actual contact time');
SELECT test_reservation_assert((SELECT (x->>'followups')::int=(b->>'followups')::int+1 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x,jsonb_array_elements((SELECT value->'employees' FROM test_followup29 WHERE key='target_before'))b WHERE x->>'id'=test_id(11)::text AND b->>'id'=x->>'id'),'SQL29 only the outcome-documented unique client changes the daily target');
SELECT test_reservation_assert((SELECT (x->>'followup_clients')::int=(b->>'followup_clients')::int+1 FROM jsonb_array_elements(crm_employee_performance(date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,(now() AT TIME ZONE 'Asia/Muscat')::date+1)->'employees')x,jsonb_array_elements((SELECT value->'employees' FROM test_followup29 WHERE key='performance_before'))b WHERE x->>'employee_id'=test_id(11)::text AND b->>'employee_id'=x->>'employee_id'),'SQL28/29 performance and daily targets both credit the same new documented client');
-- A different event to the same client remains one unique followed-up client.
SELECT crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','followup','outcome','Synthetic second attempt','next_followup',current_date+2),test_id(29052)) FROM property_inquiries WHERE id=test_id(29030);
SELECT test_reservation_assert((SELECT (x->>'followups')::int=(b->>'followups')::int+1 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x,jsonb_array_elements((SELECT value->'employees' FROM test_followup29 WHERE key='target_before'))b WHERE x->>'id'=test_id(11)::text AND b->>'id'=x->>'id'),'SQL29 repeated genuine attempts do not inflate unique-client goals');
SELECT test_reservation_assert((SELECT (x->>'followup_clients')::int=(b->>'followup_clients')::int+1 FROM jsonb_array_elements(crm_employee_performance(date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,(now() AT TIME ZONE 'Asia/Muscat')::date+1)->'employees')x,jsonb_array_elements((SELECT value->'employees' FROM test_followup29 WHERE key='performance_before'))b WHERE x->>'employee_id'=test_id(11)::text AND b->>'employee_id'=x->>'employee_id'),'SQL28/29 repeat events remain one followed-up client in period performance');
-- Invalid reason rolls back inquiry, request/contact and activity together.
INSERT INTO test_followup29 VALUES('before_failed',(SELECT to_jsonb(q) FROM property_inquiries q WHERE id=test_id(29030)));
DO $$ BEGIN
 BEGIN
  PERFORM crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','not_suitable','outcome','Must not commit','reason_id',test_id(29999),'next_followup',current_date+7),test_id(29053)) FROM property_inquiries WHERE id=test_id(29030);
  RAISE EXCEPTION 'invalid reason was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT test_reservation_assert((SELECT to_jsonb(q) FROM property_inquiries q WHERE id=test_id(29030))=(SELECT value FROM test_followup29 WHERE key='before_failed') AND NOT EXISTS(SELECT 1 FROM activities WHERE id=test_id(29053)),'SQL29 invalid reason rolls back the entire follow-up');
DO $$ BEGIN
 BEGIN PERFORM crm_save_inquiry_followup(jsonb_set((SELECT value FROM test_followup29 WHERE key='human_payload'),'{expected_updated_at}','"2001-01-01T00:00:00Z"'),test_id(29054));RAISE EXCEPTION 'stale version accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM crm_save_inquiry_followup(jsonb_set((SELECT value FROM test_followup29 WHERE key='human_payload'),'{outcome}','"Different payload"'),test_id(29050));RAISE EXCEPTION 'changed replay accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','reserved','outcome','Must not create fake booking'),test_id(29055)) FROM property_inquiries WHERE id=test_id(29030);RAISE EXCEPTION 'unsupported booking accepted';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'inquiry_requires_paid_reservation_workflow' THEN RAISE;END IF;END;
 BEGIN PERFORM crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','viewed','outcome','Must not fabricate visit'),test_id(29056)) FROM property_inquiries WHERE id=test_id(29030);RAISE EXCEPTION 'unsupported visit accepted';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'inquiry_requires_actual_viewing' THEN RAISE;END IF;END;
 BEGIN PERFORM crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','negotiation','outcome','Must not fabricate deal'),test_id(29057)) FROM property_inquiries WHERE id=test_id(29030);RAISE EXCEPTION 'unsupported deal accepted';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'inquiry_requires_deal_workflow' THEN RAISE;END IF;END;
END $$;
-- Same legacy stage + genuinely new follow-up: keep unknown historic dates NULL.
SELECT crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','negotiation','outcome','Synthetic new legacy follow-up','next_followup',current_date+1),test_id(29058)) FROM property_inquiries WHERE id=test_id(29032);
SELECT test_reservation_assert((SELECT negotiation_started_at IS NULL AND opportunity_opened_at IS NULL FROM client_requests WHERE id=test_id(29021)),'SQL29 new follow-up does not invent unknown historical negotiation dates');
SELECT set_config('test.actor',test_id(12)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='human_payload'),test_id(29059));RAISE EXCEPTION 'opposite branch accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='private_payload'),test_id(29062));RAISE EXCEPTION 'employee private inquiry accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','no_response','outcome','Synthetic Barka no answer','next_followup',current_date+1),test_id(29060)) FROM property_inquiries WHERE id=test_id(29031);
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM activities WHERE id=test_id(29060) AND user_id=test_id(12) AND type='followup'),'SQL29 Barka saves its own outcome');
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='human_payload'),test_id(29061));RAISE EXCEPTION 'viewer accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(13)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='private_payload'),test_id(29063));RAISE EXCEPTION 'manager private inquiry accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(15)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='human_payload'),test_id(29064));RAISE EXCEPTION 'inactive owner accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT crm_save_inquiry_followup((SELECT value FROM test_followup29 WHERE key='private_payload'),test_id(29065));
SELECT test_reservation_assert((SELECT to_jsonb(c) FROM clients c WHERE id=test_id(106))=(SELECT value FROM test_followup29 WHERE key='private_parent_before'),'SQL29 owner private follow-up never changes the ordinary branch client summary');
UPDATE client_requests SET negotiation_started_at=NULL,opportunity_opened_at=NULL WHERE id=test_id(200);
SELECT crm_save_inquiry_followup(jsonb_build_object('inquiry_id',id,'expected_updated_at',updated_at,'status','negotiation','outcome',NULL,'next_followup',current_date+1),test_id(29066)) FROM property_inquiries WHERE id=test_id(1400);
SELECT test_reservation_assert((SELECT negotiation_started_at>=now()-interval '1 minute' AND opportunity_opened_at>=now()-interval '1 minute' FROM client_requests WHERE id=test_id(200)),'SQL29 newly recorded backed transition never borrows an old contact date');
SELECT test_reservation_assert((SELECT outcome IS NULL AND type='system' FROM activities WHERE id=test_id(29066)),'SQL29 backed stage administration alone is not a new contact');
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM activities WHERE id=test_id(29065)),'SQL29 private activity and its evidence remain hidden from branch staff');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM deals d)=(SELECT value FROM test_followup29 WHERE key='deal_before'),'SQL29 creates no duplicate deal and does not alter any closed/other deal');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb) FROM viewings v)=(SELECT value FROM test_followup29 WHERE key='viewing_before'),'SQL29 does not invent or alter visits');
SELECT test_reservation_assert(NOT has_function_privilege('anon','public.crm_save_inquiry_followup(jsonb,uuid)','execute'),'SQL29 anonymous follow-up writes denied');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.crm_save_inquiry_followup(jsonb,uuid)'::regprocedure AND prosecdef),'SQL29 follow-up uses invoker RLS');
INSERT INTO test_followup29 VALUES('preserve_before_rollback',jsonb_build_object('inquiries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM property_inquiries q),'activities',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM activities a),'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM client_requests r)));
SELECT 'inquiry follow-up assertions passed' result;
