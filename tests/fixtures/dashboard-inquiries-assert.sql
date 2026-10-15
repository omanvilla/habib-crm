-- Synthetic integration assertions: exact saved links, real policy/trigger graph.
-- Run after investment-owner-only.sql, SQL18 and SQL21 in an isolated database.
BEGIN;
SELECT set_config('test.actor',test_id(10)::text,true);
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type)
VALUES(test_id(4100),test_id(1),test_id(12),'Synthetic saved-link client','+96891104100','barka','buyer');
INSERT INTO properties(id,company_id,title,type,branch_key,sourced_by,added_by,area,price,status)
VALUES(test_id(4200),test_id(1),'Synthetic saved-link property','villa','barka',test_id(12),test_id(12),'بركاء',100000,'available');
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
VALUES(test_id(4300),test_id(1),test_id(4100),test_id(12),'barka','synthetic-barka','96891104100','+96891104100'),
(test_id(4301),test_id(1),test_id(4100),test_id(11),'muscat','synthetic-muscat','96891104100','+96891104100'),
(test_id(4302),test_id(1),test_id(4100),test_id(10),'investment','synthetic-investment','96891104100','+96891104100');
SELECT set_config('test.actor','',true);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,body,message_timestamp)
VALUES(test_id(4400),test_id(1),test_id(4300),test_id(4100),'wamid.synthetic.savedlink4400','inbound','text','https://instagram.com/reel/SYNTHLINK4200/','2026-10-04T08:10:00Z'),
(test_id(4401),test_id(1),test_id(4301),test_id(4100),'wamid.synthetic.savedlink4401','inbound','text','https://instagram.com/reel/SYNTHLINK4200/','2026-10-04T09:10:00Z'),
(test_id(4402),test_id(1),test_id(4302),test_id(4100),'wamid.synthetic.savedlink4402','inbound','text','https://instagram.com/reel/SYNTHLINK4200/','2026-10-04T10:10:00Z'),
(test_id(4403),test_id(1),test_id(4300),test_id(4100),'wamid.synthetic.savedlink4403','inbound','text','https://instagram.com/reel/SYNTHLINK4203/','2026-10-04T11:10:00Z');
SELECT test_assert((SELECT count(*) FROM unmatched_property_links WHERE whatsapp_message_id IN(test_id(4400),test_id(4401),test_id(4402),test_id(4403)) AND status='pending')=4,'four unknown references must wait before a link is saved');
CREATE TEMP TABLE inquiry_other_before AS
SELECT 'clients' table_name,id row_id,to_jsonb(c) row_data FROM clients c WHERE id IN(test_id(100),test_id(101))
UNION ALL SELECT 'company_lead_routes',id,to_jsonb(r) FROM company_lead_routes r WHERE company_id=test_id(1);

-- The Barka employee saving a known link can resolve only her own ordinary inbox.
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(12)::text,true);
INSERT INTO property_marketing_events(id,company_id,property_id,channel,event_type,url,created_by)
VALUES(test_id(4500),test_id(1),test_id(4200),'instagram','publish','https://instagram.com/reel/SYNTHLINK4200/',test_id(12));
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM property_message_attributions WHERE message_id=test_id(4400) AND method='exact_link')=1,'saved link did not reconcile exact own-branch reference');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(4401),test_id(4402),test_id(4403))),'staff link save crossed branch/private/unknown boundary');
SELECT test_assert((SELECT first_inquiry_at='2026-10-04T08:10:00Z'::timestamptz AND last_inquiry_at='2026-10-04T08:10:00Z'::timestamptz AND has_inbound_inquiry FROM property_inquiries WHERE source_whatsapp_message_id=test_id(4400)),'business timestamp or real inbound marker changed');
SELECT test_assert((SELECT property_match_status='auto_matched' FROM whatsapp_messages WHERE id=test_id(4400)),'exact saved link must not claim human manual resolution');
SELECT test_assert((SELECT resolved_by IS NULL AND status='resolved' FROM unmatched_property_links WHERE whatsapp_message_id=test_id(4400)),'automatic reconciliation invented a manual resolver');

-- Owner saving the same link can resolve the separate private investment work.
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,true);
UPDATE property_marketing_events SET url=url WHERE id=test_id(4500);
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM property_inquiries i JOIN client_requests r ON r.id=i.request_id WHERE i.source_whatsapp_message_id=test_id(4402)
 AND r.request_type='investor' AND r.route_key='investment' AND r.branch_key='investment' AND i.assigned_to=test_id(10)),'owner link-save did not preserve canonical private investment request');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(4401),test_id(4403))),'owner auto reconciliation guessed a cross-branch or unmapped link');
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(4100))=2,'ordinary/private inquiry compartments were merged');
CREATE TEMP TABLE saved_link_retry_before AS SELECT to_jsonb(i) row_data FROM property_inquiries i WHERE client_id=test_id(4100);
UPDATE property_marketing_events SET url=url WHERE id=test_id(4500);
SELECT test_assert((SELECT count(*) FROM property_message_attributions WHERE message_id IN(test_id(4400),test_id(4402)))=2,'repeated link save duplicated attribution');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_inquiries i WHERE i.client_id=test_id(4100) AND to_jsonb(i) NOT IN(SELECT row_data FROM saved_link_retry_before)),'repeated link save incremented or mutated inquiries');

SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(12)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_inquiries WHERE source_whatsapp_message_id=test_id(4402)),'private reconciled inquiry leaked to employee');
SELECT test_assert(NOT has_function_privilege('authenticated','crm_repair_private.reconcile_saved_property_link(uuid,uuid[])','EXECUTE'),'authenticated role can directly call private reconciliation');
SELECT test_assert(NOT has_function_privilege('anon','crm_repair_private.reconcile_saved_property_link(uuid,uuid[])','EXECUTE'),'anonymous role can call private reconciliation');
RESET ROLE;
DO $$DECLARE b record;actual jsonb;BEGIN
 FOR b IN SELECT * FROM inquiry_other_before LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',b.table_name) INTO actual USING b.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM b.row_data,'saved-link reconciliation changed unrelated client/routing: '||b.table_name);
 END LOOP;
END$$;

-- Explicit repair is bounded to reviewed message IDs, even when the same link
-- has older pending references. No accidental all-history backfill.
SELECT set_config('test.actor','',true);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,body,message_timestamp)
VALUES(test_id(4405),test_id(1),test_id(4300),test_id(4100),'wamid.synthetic.savedlink4405','inbound','text','https://instagram.com/reel/SYNTHLINK4203/','2026-09-04T11:10:00Z');
ALTER TABLE property_marketing_events DISABLE TRIGGER reconcile_property_link_after_save;
INSERT INTO property_marketing_events(id,company_id,property_id,channel,event_type,url,created_by)
VALUES(test_id(4503),test_id(1),test_id(4200),'instagram','publish','https://instagram.com/reel/SYNTHLINK4203/',test_id(10));
ALTER TABLE property_marketing_events ENABLE TRIGGER reconcile_property_link_after_save;
SET LOCAL ROLE service_role;
SELECT test_assert(crm_repair_private.reconcile_saved_property_link(test_id(4503),ARRAY[test_id(4403)])=1,'bounded service repair did not resolve exactly the reviewed message');
SELECT test_assert(crm_repair_private.reconcile_saved_property_link(test_id(4503),ARRAY[test_id(4403)])=0,'bounded repair retry was not idempotent');
RESET ROLE;
SELECT test_assert((SELECT status='pending' FROM unmatched_property_links WHERE whatsapp_message_id=test_id(4405)),'bounded repair changed an older unreviewed occurrence');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id=test_id(4405)),'bounded repair guessed historical attribution');
ROLLBACK;
