-- Synthetic-only SQL18 mixed-phone attribution regression; no external network or sends.
-- Run after investment-owner-only.sql, SQL18, and investment-owner-only-assert.sql.
BEGIN;
SELECT set_config('test.actor',test_id(10)::text,true);
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type)
VALUES(test_id(3000),test_id(1),test_id(11),'Synthetic mixed attribution parent','+96891103000','muscat','buyer');
INSERT INTO properties(id,company_id,title,property_code,type,branch_key,sourced_by,added_by,area,price,status)
VALUES(test_id(3100),test_id(1),'Synthetic attribution property','SYNINV3100','villa','muscat',test_id(11),test_id(11),'مسقط',100000,'available');
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,subject_property_id,preferred_area,created_by)
VALUES(test_id(3101),test_id(1),test_id(3000),'buyer','muscat','muscat',test_id(11),test_id(3100),'مسقط',test_id(11));
INSERT INTO property_inquiries(id,company_id,client_id,property_id,request_id,assigned_to,source,status,has_inbound_inquiry,inquiry_count)
VALUES(test_id(3102),test_id(1),test_id(3000),test_id(3100),test_id(3101),test_id(11),'whatsapp','inquiry',true,4);
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
VALUES(test_id(3200),test_id(1),test_id(3000),test_id(11),'muscat','synthetic-muscat','96891103000','+96891103000'),
(test_id(3201),test_id(1),test_id(3000),test_id(10),'investment','synthetic-investment','96891103000','+96891103000');
CREATE TEMP TABLE attribution_before AS
SELECT 'clients' AS table_name,id AS row_id,to_jsonb(c) AS row_data FROM clients c WHERE id=test_id(3000)
UNION ALL SELECT 'client_requests',id,to_jsonb(r) FROM client_requests r WHERE id=test_id(3101)
UNION ALL SELECT 'property_inquiries',id,to_jsonb(i) FROM property_inquiries i WHERE id=test_id(3102);
-- The physical investment line is authoritative even though this phone already belongs to Muscat.
SELECT set_config('test.actor','',true);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,recipient_wa_id)
VALUES(test_id(3300),test_id(1),test_id(3201),test_id(3000),'wamid.synthetic.investment.3300','inbound','property-code:SYNINV3100',now(),'+96890000003');
DO $$DECLARE b record;actual jsonb;BEGIN
 FOR b IN SELECT * FROM attribution_before LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',b.table_name) INTO actual USING b.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM b.row_data,'private inbound changed public parent/request/inquiry: '||b.table_name);
 END LOOP;
END$$;
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(3000) AND subject_property_id=test_id(3100) AND route_key='investment' AND branch_key='investment' AND request_type='investor' AND assigned_to=test_id(10))=1,'private attribution did not create exactly one canonical owner request');
SELECT test_assert((SELECT count(*) FROM property_inquiries i JOIN client_requests r ON r.id=i.request_id WHERE i.client_id=test_id(3000) AND i.source_whatsapp_message_id=test_id(3300) AND r.route_key='investment' AND i.assigned_to=test_id(10))=1,'private inquiry not immediately request-linked');
-- A privacy boundary is required before finalization, not just after later webhook work.
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,true);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(3000)) AND EXISTS(SELECT 1 FROM property_inquiries WHERE id=test_id(3102)),'ordinary identity/history unexpectedly hidden');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_inquiries WHERE source_whatsapp_message_id=test_id(3300)),'private pre-finalization inquiry leaked');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM client_requests WHERE client_id=test_id(3000) AND route_key='investment'),'private generated request leaked');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(3300)),'private inbound leaked');
RESET ROLE;
SELECT set_config('test.actor','',true);
SELECT crm_finalize_property_message(test_id(3300));
SELECT crm_finalize_property_message(test_id(3300));
SELECT test_assert(EXISTS(SELECT 1 FROM whatsapp_messages m JOIN client_requests r ON r.id=m.request_id WHERE m.id=test_id(3300) AND r.route_key='investment'),'private finalized message missing canonical request link');
SELECT record_property_link_inquiry_internal(test_id(1),test_id(3000),test_id(3100),NULL,test_id(3300),'property-code:SYNINV3100','property-code:SYNINV3100',now(),false);
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(3000) AND route_key='investment')=1 AND (SELECT count(*) FROM property_inquiries WHERE client_id=test_id(3000))=2,'private attribution retries duplicated request/inquiry');
-- Image evidence uses the same guarded attribution path and reuses only the private request.
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,body,message_timestamp,recipient_wa_id)
VALUES(test_id(3301),test_id(1),test_id(3201),test_id(3000),'wamid.synthetic.investment.3301','inbound','image','',now(),'+96890000003');
SELECT crm_apply_property_image_evidence(test_id(3301),'{"confidence":0.99,"has_literal_reference":true,"urls":[],"property_codes":["SYNINV3100"]}'::jsonb);
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(3000) AND route_key='investment')=1 AND (SELECT inquiry_count FROM property_inquiries WHERE client_id=test_id(3000) AND id<>test_id(3102))=2,'image attribution failed private request reuse');
DO $$DECLARE b record;actual jsonb;BEGIN
 FOR b IN SELECT * FROM attribution_before LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',b.table_name) INTO actual USING b.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM b.row_data,'private image changed public parent/request/inquiry: '||b.table_name);
 END LOOP;
END$$;
CREATE TEMP TABLE private_attribution_before AS SELECT id,to_jsonb(i) AS row_data FROM property_inquiries i WHERE client_id=test_id(3000) AND id<>test_id(3102);
-- The same customer's ordinary Muscat message continues to update the original ordinary inquiry.
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,recipient_wa_id)
VALUES(test_id(3302),test_id(1),test_id(3200),test_id(3000),'wamid.synthetic.muscat.3302','inbound','property-code:SYNINV3100',now(),'+96890000001');
SELECT test_assert((SELECT inquiry_count FROM property_inquiries WHERE id=test_id(3102))=5,'ordinary attribution no longer updates its original inquiry');
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(3000))=2,'ordinary message duplicated/crossed request compartment');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM private_attribution_before b JOIN property_inquiries i ON i.id=b.id WHERE b.row_data IS DISTINCT FROM to_jsonb(i)),'ordinary inbound mutated investment inquiry');
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,true);
SELECT test_assert(EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(3302)),'real-style wamid ordinary message hidden');
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(3000))=1,'Muscat sees private inquiry after finalization');
SELECT test_assert((crm_client_360(test_id(3000))->'metrics'->>'requests_total')::int=1,'private investment counted in staff client360');
SELECT set_config('test.actor',test_id(12)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id IN(test_id(3300),test_id(3301),test_id(3302))),'Barka gained investor or Muscat messages');
SELECT set_config('test.actor',test_id(13)::text,true);
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(3000))=1,'manager sees private inquiry');
SELECT set_config('test.actor',test_id(14)::text,true);
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(3000))=1,'viewer sees private inquiry');
SELECT set_config('test.actor',test_id(10)::text,true);
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(3000))=2,'owner cannot see both request histories');
RESET ROLE;
SELECT set_config('test.actor','',true);
SELECT 'Investment mixed-parent attribution, image evidence, idempotence and ordinary-branch regressions passed' AS result;
ROLLBACK;
