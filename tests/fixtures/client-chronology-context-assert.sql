-- Isolated synthetic database only. Full existing catalog+SQL18+SQL22+SQL34 required.
BEGIN;
SELECT set_config('test.actor','',true);
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type,created_at) VALUES
(test_id(9000),test_id(1),test_id(11),'Synthetic fresh context client','+96891109000','muscat','buyer','2026-10-21T12:00:00Z'),
(test_id(9001),test_id(1),test_id(12),'Synthetic Barka chronology','+96891109001','barka',NULL,'2026-10-21T12:00:00Z'),
(test_id(9002),test_id(1),test_id(11),'Synthetic manual chronology','+96891109002','muscat',NULL,'2026-10-21T12:00:00Z');
INSERT INTO properties(id,company_id,title,type,branch_key,sourced_by,added_by,area,price,status,description,map_url,public_details,land_size,built_size) VALUES
(test_id(9100),test_id(1),'فيلا الخوض للبيع','villa','muscat',test_id(11),test_id(11),'الخوض',120000,'available','فيلا للبيع','https://maps.app.goo.gl/SYNTH34MAP','للبيع فيلا في الخوض أرض 275 وبناء 438',275,438),
(test_id(9101),test_id(1),'فيلا بركاء للبيع','villa','barka',test_id(12),test_id(12),'بركاء',59000,'available','فيلا للبيع',NULL,NULL,305,295);
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone) VALUES
(test_id(9200),test_id(1),test_id(9000),test_id(11),'muscat','synthetic-context-muscat','96891109000','+96891109000'),
(test_id(9201),test_id(1),test_id(9001),test_id(12),'barka','synthetic-context-barka','96891109001','+96891109001');
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,actor_type,delivery_status,body,message_timestamp) VALUES
(test_id(9300),test_id(1),test_id(9200),test_id(9000),'wamid.context.9300','outbound','text','human','sent','هلا','2026-01-01T08:00:00Z'),
(test_id(9301),test_id(1),test_id(9200),test_id(9000),'wamid.context.9301','inbound','text',NULL,NULL,'ممكن تفاصيل فيلا الخوض 120 ألف','2026-10-20T20:05:00Z'),
(test_id(9302),test_id(1),test_id(9200),test_id(9000),'wamid.context.9302','inbound','text',NULL,NULL,'أرسل اللوكيشن','2026-10-20T20:06:00Z'),
(test_id(9303),test_id(1),test_id(9200),test_id(9000),'wamid.context.9303','inbound','text',NULL,NULL,'ممكن التفاصيل','2026-10-20T20:07:00Z'),
(test_id(9304),test_id(1),test_id(9200),test_id(9000),'wamid.context.9304','outbound','text','human','sent','فيلا الخوض 120 ألف','2026-10-20T20:08:00Z'),
(test_id(9305),test_id(1),test_id(9200),test_id(9000),'wamid.context.9305','inbound','text',NULL,NULL,'ممكن اللوكيشن','2026-10-20T20:09:00Z'),
(test_id(9306),test_id(1),test_id(9200),test_id(9000),'wamid.context.9306','inbound','text',NULL,NULL,'الموقع لعقار ثاني','2026-10-20T20:10:00Z'),
(test_id(9307),test_id(1),test_id(9200),test_id(9000),'wamid.context.9307','inbound','text',NULL,NULL,'الموقع','2026-10-22T20:10:00Z'),
(test_id(9308),test_id(1),test_id(9201),test_id(9001),'wamid.context.9308','inbound','text',NULL,NULL,'هلا','2026-10-21T08:00:00Z');
CREATE TEMP TABLE before_visits AS SELECT (SELECT count(*) FROM viewings) AS visits,(SELECT count(*) FROM appointments) AS appointments;
GRANT SELECT ON before_visits TO service_role;
-- Security-invoker time reads ignore earlier outgoing messages and preserve first inbound.
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,true);
SELECT test_assert((SELECT first_contact_at='2026-10-20T20:05:00Z' AND first_contact_source='whatsapp' FROM crm_client_first_contacts(ARRAY[test_id(9000)])),'wrong actual first inbound');
SELECT test_assert((SELECT first_contact_at IS NULL FROM crm_client_first_contacts(ARRAY[test_id(9002)])),'manual record received invented contact time');
SELECT set_config('test.actor',test_id(12)::text,true);
SELECT test_assert((SELECT count(*) FROM crm_client_first_contacts(ARRAY[test_id(9000),test_id(9001),test_id(102)]))=1,'branch/private timestamp leak');
SELECT set_config('test.actor',test_id(15)::text,true);
SELECT test_assert((SELECT count(*) FROM crm_client_first_contacts(ARRAY[test_id(9000),test_id(9001)]))=0,'inactive first-contact leak');
RESET ROLE;
SELECT set_config('test.actor','',true);
SELECT test_assert(NOT has_function_privilege('anon','public.crm_client_first_contacts(uuid[])','EXECUTE'),'anon chronology execute');
SELECT test_assert(NOT has_function_privilege('authenticated','public.crm_apply_property_context_followup(uuid,uuid,uuid)','EXECUTE'),'staff direct context execute');
SELECT test_assert(NOT has_function_privilege('authenticated','public.crm_record_location_interest(uuid)','EXECUTE'),'staff direct intent execute');
SET LOCAL ROLE service_role;
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(crm_property_inquiry_candidates(test_id(9301))->'candidates') p WHERE p->>'id'=test_id(9100)::text AND p->>'map_url'='https://maps.app.goo.gl/SYNTH34MAP'),'candidate map missing');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(crm_property_inquiry_candidates(test_id(9301))->'candidates') p WHERE p->>'id'=test_id(9101)::text),'candidate branch widened');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(9301),jsonb_build_array(jsonb_build_object('property_id',test_id(9100),'method','ai_verified','evidence',jsonb_build_object('kind','text','quote','فيلا الخوض 120 ألف','source_message_ids',jsonb_build_array(test_id(9301)),'matched_facts','{}'::jsonb))))->>'matched_count')::int=1,'initial identity not established');
SELECT test_assert((crm_apply_property_context_followup(test_id(9302),test_id(9301),test_id(9100))->>'matched_count')::int=1,'location followup not attached');
SELECT test_assert((SELECT count(*) FROM client_request_events WHERE whatsapp_message_id=test_id(9302) AND event_type='location_requested' AND occurred_at='2026-10-20T20:06:00Z' AND after_data->>'appointment_created'='false')=1,'location intent missing or wrong timestamp');
SELECT test_assert((crm_apply_property_context_followup(test_id(9302),test_id(9301),test_id(9100))->>'matched_count')::int=0,'retry duplicate attribution');
SELECT test_assert((SELECT count(*) FROM client_request_events WHERE whatsapp_message_id=test_id(9302) AND event_type='location_requested')=1,'retry duplicate interest');
SELECT test_assert((crm_apply_property_context_followup(test_id(9305),test_id(9304),test_id(9100))->>'blocked_reason')='followup_source_not_verified','unverified staff broadcast was accepted');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(9303),jsonb_build_array(jsonb_build_object('property_id',test_id(9100),'method','ai_verified','evidence',jsonb_build_object('kind','conversation','quote','فيلا الخوض 120 ألف','source_message_ids',jsonb_build_array(test_id(9303),test_id(9304)),'matched_facts','{}'::jsonb))))->>'matched_count')::int=1,'verified staff answer failed');
SELECT test_assert((crm_apply_property_context_followup(test_id(9305),test_id(9304),test_id(9100))->>'matched_count')::int=1,'verified staff context not reusable');
SELECT test_assert((crm_apply_property_context_followup(test_id(9306),test_id(9305),test_id(9100))->>'matched_count')::int=0,'alternative reused old identity');
SELECT test_assert((crm_apply_property_context_followup(test_id(9307),test_id(9305),test_id(9100))->>'matched_count')::int=0,'old context reused after24h');
SELECT test_assert((crm_apply_property_context_followup(test_id(9305),test_id(9301),test_id(9100))->>'blocked_reason')='followup_not_adjacent','non-adjacent context accepted');
SELECT test_assert((crm_apply_property_context_followup(test_id(9305),test_id(9304),test_id(9101))->>'matched_count')::int=0,'different property accepted');
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(9000))=1,'followups duplicate independent request');
SELECT test_assert((SELECT count(*) FROM viewings)=(SELECT visits FROM before_visits) AND (SELECT count(*) FROM appointments)=(SELECT appointments FROM before_visits),'location created actual visit');
RESET ROLE;
ROLLBACK;
