-- Synthetic only: run after full investment fixture, SQL18 and SQL22.
BEGIN;
SELECT set_config('test.actor','',true);
CREATE FUNCTION pg_temp.semantic_match(mid integer,pid integer,kind text,quote text,sources integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('property_id',test_id(pid),'method','ai_verified','evidence',jsonb_build_object(
  'kind',kind,'quote',quote,'matched_facts',jsonb_build_object('area','الخوض','price',135000),
  'source_message_ids',(SELECT jsonb_agg(test_id(i)) FROM unnest(coalesce(sources,ARRAY[mid])) i)))
$$;
CREATE FUNCTION pg_temp.semantic_reject(mid integer, matches jsonb, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.crm_apply_verified_property_inquiries(test_id(mid),matches,false);
  RAISE EXCEPTION 'expected semantic rejection: %',expected;
 EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM=expected,'wrong rejection: '||SQLERRM||' expected '||expected);END;
END$$;

INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type) VALUES
(test_id(6000),test_id(1),test_id(11),'Synthetic semantic buyer','+96891106000','muscat','buyer'),
(test_id(6001),test_id(1),test_id(11),'Synthetic blank semantic buyer','+96891106001','muscat',NULL),
(test_id(6002),test_id(1),test_id(11),'Synthetic semantic seller','+96891106002','muscat','seller'),
(test_id(6003),test_id(1),test_id(12),'Synthetic conflicting parent','+96891106003','muscat','buyer'),
(test_id(6004),test_id(1),test_id(12),'Synthetic Barka semantic buyer','+96891106004','barka','buyer'),
(test_id(6005),test_id(1),test_id(10),'Synthetic private semantic investor','+96891106005','investment','investor'),
(test_id(6006),test_id(1),test_id(11),'Synthetic visit derived buyer','+96891106006','muscat','buyer'),
(test_id(6007),test_id(1),test_id(11),'Synthetic consultation parent','+96891106007','muscat','consultation');
INSERT INTO properties(id,company_id,title,type,branch_key,sourced_by,added_by,area,price,status,description) VALUES
(test_id(6100),test_id(1),'فيلا الخوض السابعة للبيع','villa','muscat',test_id(11),test_id(11),'الخوض السابعة',135000,'available','فيلا للبيع'),
(test_id(6101),test_id(1),'فيلا الخوض الرابعة للبيع','villa','muscat',test_id(11),test_id(11),'الخوض الرابعة',109000,'available','فيلا للبيع'),
(test_id(6102),test_id(1),'فيلا بركاء للبيع','villa','barka',test_id(12),test_id(12),'بركاء',69000,'available','فيلا للبيع');
INSERT INTO properties(id,company_id,title,type,branch_key,sourced_by,added_by,area,price,status,description,owner_client_id) VALUES
(test_id(6103),test_id(1),'PRIVATE INVESTOR OWNED MUSCAT PROPERTY','villa','muscat',test_id(11),test_id(11),'الخوض',135000,'available','فيلا للبيع',test_id(102));
INSERT INTO properties(id,company_id,title,type,branch_key,sourced_by,added_by,area,price,status,description,archived) VALUES
(test_id(6104),test_id(1),'ARCHIVED PROPERTY','villa','muscat',test_id(11),test_id(11),'الخوض',135000,'available','فيلا للبيع',true);
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone) VALUES
(test_id(6200),test_id(1),test_id(6000),test_id(11),'muscat','synthetic-semantic-muscat','96891106000','+96891106000'),
(test_id(6201),test_id(1),test_id(6001),test_id(11),'muscat','synthetic-semantic-muscat','96891106001','+96891106001'),
(test_id(6202),test_id(1),test_id(6002),test_id(11),'muscat','synthetic-semantic-muscat','96891106002','+96891106002'),
(test_id(6203),test_id(1),test_id(6003),test_id(11),'muscat','synthetic-semantic-muscat','96891106003','+96891106003'),
(test_id(6204),test_id(1),test_id(6004),test_id(12),'barka','synthetic-semantic-barka','96891106004','+96891106004'),
(test_id(6205),test_id(1),test_id(6005),test_id(10),'investment','synthetic-semantic-investment','96891106005','+96891106005'),
(test_id(6206),test_id(1),test_id(6000),test_id(10),'investment','synthetic-semantic-investment','96891106000','+96891106000'),
(test_id(6207),test_id(1),test_id(6006),test_id(11),'muscat','synthetic-semantic-muscat','96891106006','+96891106006'),
(test_id(6208),test_id(1),test_id(6007),test_id(11),'muscat','synthetic-semantic-muscat','96891106007','+96891106007');
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,body,message_timestamp) VALUES
(test_id(6300),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6300','inbound','text','ممكن تفاصيل فيلا الخوض 135 ألف','2026-10-04T08:00:00Z'),
(test_id(6301),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6301','inbound','image','','2026-10-04T09:00:00Z'),
(test_id(6302),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6302','inbound','text','عندكم فلل في الخوض؟','2026-10-04T10:00:00Z'),
(test_id(6310),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6310','inbound','text','هذا البيت موجود؟','2026-10-04T10:05:00Z'),
(test_id(6311),test_id(1),test_id(6201),test_id(6001),'wamid.semantic.6311','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z'),
(test_id(6312),test_id(1),test_id(6202),test_id(6002),'wamid.semantic.6312','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z'),
(test_id(6313),test_id(1),test_id(6203),test_id(6003),'wamid.semantic.6313','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z'),
(test_id(6314),test_id(1),test_id(6206),test_id(6000),'wamid.semantic.6314','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z'),
(test_id(6315),test_id(1),test_id(6205),test_id(6005),'wamid.semantic.6315','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z'),
(test_id(6317),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6317','inbound','text','فيلا الخوض 135 ألف','2026-09-30T10:00:00Z'),
(test_id(6318),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6318','inbound','text','فيلا الخوض 135 ألف https://instagram.com/reel/SYNTHUNKNOWN22/','2026-10-04T10:00:00Z'),
(test_id(6319),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6319','inbound','text','فيلا الخوض 135 ألف وبيت بركاء','2026-10-04T10:00:00Z'),
(test_id(6321),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6321','inbound','text','هذا البيت موجود؟','2026-10-04T10:02:00Z'),
(test_id(6330),test_id(1),test_id(6207),test_id(6006),'wamid.semantic.6330','inbound','text','فيلا الخوض 135 ألف','2026-09-29T10:00:00Z'),
(test_id(6332),test_id(1),test_id(6208),test_id(6007),'wamid.semantic.6332','inbound','text','فيلا الخوض 135 ألف','2026-10-04T10:00:00Z');
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,message_type,actor_type,delivery_status,body,message_timestamp) VALUES
(test_id(6303),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6303','outbound','text','human','sent','فيلا الخوض 135 ألف','2026-10-04T10:01:00Z'),
(test_id(6304),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6304','outbound','text','human','sent','فيلا الخوض 109 ألف','2026-10-04T10:02:00Z'),
(test_id(6305),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6305','outbound','text','human','sent','فيلا الخوض 135 ألف','2026-10-04T09:59:00Z'),
(test_id(6306),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6306','outbound','text','human','sent','فيلا الخوض 135 ألف','2026-10-05T11:01:00Z'),
(test_id(6307),test_id(1),test_id(6204),test_id(6004),'wamid.semantic.6307','outbound','text','human','sent','فيلا الخوض 135 ألف','2026-10-04T10:01:00Z'),
(test_id(6308),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6308','outbound','text','automated','sent','فيلا الخوض 135 ألف','2026-10-04T10:01:00Z'),
(test_id(6309),test_id(1),test_id(6200),test_id(6000),'wamid.semantic.6309','outbound','text','human','failed','فيلا الخوض 135 ألف','2026-10-04T10:01:00Z');
UPDATE whatsapp_messages SET reply_to_message_id='wamid.semantic.6305' WHERE id=test_id(6310);
UPDATE whatsapp_messages SET reply_to_message_id='wamid.semantic.6304' WHERE id=test_id(6321);
UPDATE whatsapp_messages SET reply_to_message_id='wamid.semantic.6302' WHERE id=test_id(6304);
INSERT INTO client_requests(id,company_id,client_id,request_type,subject_property_id,route_key,branch_key,assigned_to,preferred_area)
VALUES(test_id(6400),test_id(1),test_id(6006),'buyer',NULL,'muscat','muscat',test_id(11),'الخوض');
INSERT INTO whatsapp_message_requests(company_id,message_id,request_id,relation)
VALUES(test_id(1),test_id(6330),test_id(6400),'mentioned');
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,preferred_area,notes)
VALUES(test_id(6402),test_id(1),test_id(6007),'consultation','muscat','muscat',test_id(11),'الخوض','Independent consultation must stay unchanged');
CREATE TEMP TABLE semantic_consult_before AS SELECT to_jsonb(r) row_data FROM client_requests r WHERE id=test_id(6402);
INSERT INTO property_inquiries(id,company_id,client_id,property_id,request_id,assigned_to,source,status,has_inbound_inquiry,first_inquiry_at,last_inquiry_at)
VALUES(test_id(6401),test_id(1),test_id(6006),test_id(6100),test_id(6400),test_id(11),'other','inquiry',false,'2026-10-03T10:00:00Z','2026-10-03T10:00:00Z');
-- Reproduce legacy persisted state: a real historical visit and its interest
-- existed while the linked generic request still had no subject property.
SET LOCAL session_replication_role=replica;
INSERT INTO viewings(id,company_id,client_id,property_id,request_id,agent_id,viewing_date,viewing_time,status,attendance,created_at)
VALUES(test_id(6403),test_id(1),test_id(6006),test_id(6100),test_id(6400),test_id(11),'2026-10-03','14:00','done','attended','2026-10-02T08:00:00Z');
SET LOCAL session_replication_role=origin;
CREATE TEMP TABLE semantic_generic_request_before AS SELECT to_jsonb(r) row_data FROM client_requests r WHERE id=test_id(6400);
CREATE TEMP TABLE semantic_original_visit_before AS SELECT to_jsonb(v) row_data FROM viewings v WHERE id=test_id(6403);
CREATE TEMP TABLE semantic_before AS SELECT id,to_jsonb(c) row_data FROM clients c WHERE id BETWEEN test_id(6000) AND test_id(6007);

SET LOCAL ROLE service_role;
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(crm_property_inquiry_candidates(test_id(6300))->'candidates') x WHERE x->>'id'=test_id(6100)::text),'ordinary candidate missing');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(crm_property_inquiry_candidates(test_id(6300))->'candidates') x WHERE x->>'id' IN(test_id(6102)::text,test_id(6103)::text,test_id(6104)::text,test_id(302)::text)),'candidate input leaked other branch/private-owner/archived listing');
SELECT test_assert(jsonb_array_length(crm_property_inquiry_candidates(test_id(6300),0,1)->'candidates')=1 AND (crm_property_inquiry_candidates(test_id(6300),0,1)->>'has_more')::boolean,'candidate pagination missing boundary');
SELECT test_assert((crm_property_inquiry_candidates(test_id(6300),0,1)->'candidates'->0->>'id')<>(crm_property_inquiry_candidates(test_id(6300),1,1)->'candidates'->0->>'id'),'candidate pages repeat first row');
SELECT test_assert(NOT (crm_property_inquiry_candidates(test_id(6300),1000,1)->>'has_more')::boolean AND jsonb_array_length(crm_property_inquiry_candidates(test_id(6300),1000,1)->'candidates')=0,'candidate terminal page incorrect');
-- This actual recorder call previously failed method='ai_verified' CHECK.
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6300),jsonb_build_array(pg_temp.semantic_match(6300,6100,'text','فيلا الخوض 135 ألف')))->>'matched_count')::int=1,'AI method constraint regression');
SELECT test_assert((SELECT method='ai_verified' AND evidence->>'kind'='text' FROM property_message_attributions WHERE message_id=test_id(6300)),'evidence provenance was not persisted');
SELECT test_assert((SELECT property_match_status='auto_matched' FROM whatsapp_messages WHERE id=test_id(6300)),'AI attribution used unsupported message status');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6300),jsonb_build_array(pg_temp.semantic_match(6300,6100,'text','فيلا الخوض 135 ألف')))->>'matched_count')::int=0,'semantic retry double counted');
SELECT test_assert((SELECT inquiry_count=1 FROM property_inquiries WHERE source_whatsapp_message_id=test_id(6300)),'retry incremented inquiry count');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6301),jsonb_build_array(pg_temp.semantic_match(6301,6100,'image','فيلا الخوض 135 ألف')))->>'matched_count')::int=1,'image evidence attribution failed');
SELECT test_assert((SELECT status='resolved' FROM unmatched_property_links WHERE whatsapp_message_id=test_id(6301) AND link_key='image:'||test_id(6301)::text),'image reference not resolved');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6302),jsonb_build_array(
 pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6303]),
 pg_temp.semantic_match(6302,6101,'conversation','فيلا الخوض 109 ألف',ARRAY[6302,6304])))->>'matched_count')::int=2,'multiple genuinely answered listings not attributed');
SELECT test_assert((SELECT matched_property_id IS NULL AND property_match_status='multiple_matched' FROM whatsapp_messages WHERE id=test_id(6302)),'multi match misleading single property summary');
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id=test_id(6000) AND subject_property_id IN(test_id(6100),test_id(6101)))=2,'independent property requests collapsed');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(6303),test_id(6304))),'outbound was counted as inbound inquiry');

SELECT pg_temp.semantic_reject(6303,'[]','inbound_message_required');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6305])),'unrelated_prior_property_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6306])),'invalid_property_support_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6307])),'invalid_property_support_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6308])),'invalid_property_support_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6309])),'invalid_property_support_message');
UPDATE whatsapp_messages SET delivery_status='undelivered' WHERE id=test_id(6309);
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6309])),'invalid_property_support_message');
UPDATE whatsapp_messages SET delivery_status='rejected' WHERE id=test_id(6309);
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6309])),'invalid_property_support_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف')),'property_response_required');
SELECT pg_temp.semantic_reject(6300,jsonb_build_array(pg_temp.semantic_match(6300,6100,'text','invented excerpt')),'property_quote_not_in_message');
SELECT pg_temp.semantic_reject(6302,jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','invented excerpt',ARRAY[6302,6303])),'property_quote_not_in_response');
SELECT pg_temp.semantic_reject(6300,jsonb_build_array(pg_temp.semantic_match(6300,6100,'image','فيلا الخوض 135 ألف')),'invalid_property_evidence_sources');
SELECT pg_temp.semantic_reject(6300,jsonb_build_array(pg_temp.semantic_match(6300,6100,'text','فيلا الخوض 135 ألف',ARRAY[6301])),'invalid_property_evidence_sources');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6310),jsonb_build_array(pg_temp.semantic_match(6310,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6310,6305])))->>'matched_count')::int=1,'actual inbound reply to earlier staff listing rejected');
UPDATE whatsapp_messages SET reply_to_message_id=test_id(6305)::text WHERE id=test_id(6310);
SELECT test_assert(jsonb_array_length(crm_apply_verified_property_inquiries(test_id(6310),jsonb_build_array(pg_temp.semantic_match(6310,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6310,6305])))->'property_ids')=1,'UUID quoted inbound source rejected');
UPDATE whatsapp_messages SET reply_to_message_id=test_id(6302)::text WHERE id=test_id(6303);
SELECT test_assert(jsonb_array_length(crm_apply_verified_property_inquiries(test_id(6302),jsonb_build_array(pg_temp.semantic_match(6302,6100,'conversation','فيلا الخوض 135 ألف',ARRAY[6302,6303])))->'property_ids')=1,'UUID staff reply to inbound rejected');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6321),jsonb_build_array(pg_temp.semantic_match(6321,6101,'conversation','فيلا الخوض 109 ألف',ARRAY[6321,6304])))->>'matched_count')::int=1,'same-second quoted inbound rejected because source has earlier reply context');

SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6311),jsonb_build_array(pg_temp.semantic_match(6311,6100,'text','فيلا الخوض 135 ألف')))->>'matched_count')::int=1,'blank sale classification not allowed');
SELECT test_assert((SELECT client_type='buyer' FROM clients WHERE id=test_id(6001)),'blank buyer type not filled');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6312),jsonb_build_array(pg_temp.semantic_match(6312,6100,'text','فيلا الخوض 135 ألف')))->>'matched_count')::int=1,'existing seller new independent buyer interest not recorded');
SELECT test_assert((SELECT client_type='seller' FROM clients WHERE id=test_id(6002)) AND EXISTS(SELECT 1 FROM client_requests WHERE client_id=test_id(6002) AND request_type='buyer'),'existing seller classification overwritten');
SELECT test_assert((crm_apply_verified_property_inquiries(test_id(6332),jsonb_build_array(pg_temp.semantic_match(6332,6100,'text','فيلا الخوض 135 ألف')))->>'matched_count')::int=1,'consultation independent purchase interest lost');
SELECT test_assert((SELECT client_type='consultation' FROM clients WHERE id=test_id(6007)) AND (SELECT count(*) FROM client_requests WHERE client_id=test_id(6007))=2,'consultation classification/request collapsed');
SELECT test_assert(coalesce(current_setting('crm.semantic_parent_client',true),'')='','semantic classification context not restored');
SELECT test_assert(crm_apply_verified_property_inquiries(test_id(6313),jsonb_build_array(pg_temp.semantic_match(6313,6100,'text','فيلا الخوض 135 ألف')))->>'blocked_reason'='parent_route_conflict','misassigned parent was reassigned');
SELECT test_assert(crm_apply_verified_property_inquiries(test_id(6319),jsonb_build_array(pg_temp.semantic_match(6319,6100,'text','فيلا الخوض 135 ألف'),pg_temp.semantic_match(6319,6102,'text','بيت بركاء')))->>'blocked_reason'='property_branch_conflict','cross branch batch not blocked');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id=test_id(6319)),'partial batch survived branch conflict');
SELECT test_assert(crm_apply_verified_property_inquiries(test_id(6319),jsonb_build_array(pg_temp.semantic_match(6319,302,'text','فيلا الخوض 135 ألف')))->>'blocked_reason'='property_branch_conflict','private property linked to ordinary inbox');
SELECT test_assert(crm_apply_verified_property_inquiries(test_id(6319),jsonb_build_array(pg_temp.semantic_match(6319,6103,'text','فيلا الخوض 135 ألف')))->>'blocked_reason'='property_branch_conflict','private-owned ordinary property linked to ordinary inbox');

-- Reprocessing real earlier inbound evidence must use its historical timestamp.
SELECT crm_apply_verified_property_inquiries(test_id(6317),jsonb_build_array(pg_temp.semantic_match(6317,6100,'text','فيلا الخوض 135 ألف')));
SELECT test_assert((SELECT first_inquiry_at='2026-09-30T10:00:00Z'::timestamptz FROM property_inquiries WHERE client_id=test_id(6000) AND property_id=test_id(6100) AND has_inbound_inquiry),'earlier real inquiry timestamp lost');
SELECT crm_apply_verified_property_inquiries(test_id(6330),jsonb_build_array(pg_temp.semantic_match(6330,6100,'text','فيلا الخوض 135 ألف')));
SELECT test_assert((SELECT has_inbound_inquiry AND first_inquiry_at='2026-09-29T10:00:00Z'::timestamptz AND last_inquiry_at='2026-09-29T10:00:00Z'::timestamptz FROM property_inquiries WHERE id=test_id(6401)),'visit dates masqueraded as inbound dates');
SELECT test_assert((SELECT count(*) FROM property_inquiries WHERE client_id=test_id(6006))=1
 AND (SELECT inquiry_id=test_id(6401) AND request_id=test_id(6400) FROM property_message_attributions WHERE message_id=test_id(6330)),
 'generic request visit interest left duplicate orphan or redirected to non-inbound interest');
SELECT test_assert((SELECT subject_property_id=test_id(6100) AND route_key='muscat' AND branch_key='muscat' FROM client_requests WHERE id=test_id(6400)),
 'exact message-linked generic request did not retain its route when binding the property');
SELECT crm_apply_verified_property_inquiries(test_id(6318),jsonb_build_array(pg_temp.semantic_match(6318,6100,'text','فيلا الخوض 135 ألف')));
SELECT test_assert((SELECT status='pending' FROM unmatched_property_links WHERE whatsapp_message_id=test_id(6318) AND link_key LIKE 'instagram%'),'unknown reference blanket resolved');
SELECT test_assert((SELECT property_match_status='partial_match' FROM whatsapp_messages WHERE id=test_id(6318)),'unknown remaining reference not partial');

-- Private physical line remains owner-only even with an ordinary shared parent.
SELECT crm_apply_verified_property_inquiries(test_id(6314),jsonb_build_array(pg_temp.semantic_match(6314,6100,'text','فيلا الخوض 135 ألف')));
SELECT crm_apply_verified_property_inquiries(test_id(6315),jsonb_build_array(pg_temp.semantic_match(6315,6100,'text','فيلا الخوض 135 ألف')));
SELECT test_assert((SELECT count(*) FROM client_requests WHERE client_id IN(test_id(6000),test_id(6005)) AND route_key='investment' AND branch_key='investment' AND request_type='investor' AND assigned_to=test_id(10))=2,'private semantic requests not canonical owner-only');
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM semantic_before b JOIN clients c ON c.id=b.id
 CROSS JOIN unnest(ARRAY['lead_route','assigned_to','name','phone','phone_normalized','created_at']) f(k)
 WHERE b.row_data->f.k IS DISTINCT FROM to_jsonb(c)->f.k),'semantic attribution changed protected client identity/routing');
SELECT test_assert((SELECT c.client_type=b.row_data->>'client_type' FROM semantic_before b JOIN clients c ON c.id=b.id WHERE c.id=test_id(6002)),'seller classification not preserved');
SELECT test_assert((SELECT to_jsonb(r)=b.row_data FROM semantic_consult_before b CROSS JOIN client_requests r WHERE r.id=test_id(6402)),'independent consultation request changed');
SELECT test_assert((SELECT to_jsonb(r)-ARRAY['subject_property_id','updated_at','last_contact_at']=b.row_data-ARRAY['subject_property_id','updated_at','last_contact_at']
 FROM semantic_generic_request_before b CROSS JOIN client_requests r WHERE r.id=test_id(6400)),
 'binding exact generic request changed fields: '||(SELECT string_agg(k,',') FROM semantic_generic_request_before b CROSS JOIN client_requests r
 CROSS JOIN LATERAL jsonb_object_keys(b.row_data) k WHERE r.id=test_id(6400) AND b.row_data->k IS DISTINCT FROM to_jsonb(r)->k));
-- The existing response-milestone trigger may fill a previously unknown last
-- contact from this genuine inbound when the message receives its request ID.
SELECT test_assert((SELECT b.row_data->>'last_contact_at' IS NULL AND r.last_contact_at='2026-09-29T10:00:00Z'::timestamptz
 FROM semantic_generic_request_before b CROSS JOIN client_requests r WHERE r.id=test_id(6400)),
 'generic request contact milestone was fabricated or lost the actual inbound timestamp');
SELECT test_assert((SELECT to_jsonb(v)=b.row_data FROM semantic_original_visit_before b CROSS JOIN viewings v WHERE v.id=test_id(6403)),
 'historical visit was replaced, redated or otherwise changed by inquiry reconciliation');
SELECT test_assert(NOT has_function_privilege('authenticated','public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean)','EXECUTE'),'semantic RPC exposed to browser roles');
SELECT test_assert(NOT has_function_privilege('authenticated','crm_repair_private.semantic_property_is_private(uuid,uuid)','EXECUTE'),'private classifier exposed');
SELECT test_assert(NOT has_function_privilege('authenticated','public.crm_property_inquiry_candidates(uuid,integer,integer)','EXECUTE') AND NOT has_function_privilege('anon','public.crm_property_inquiry_candidates(uuid,integer,integer)','EXECUTE'),'candidate RPC exposed');
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(6314),test_id(6315))),'Muscat sees private semantic evidence');
SELECT test_assert(EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id=test_id(6300)),'Muscat lost ordinary semantic inquiry');
-- A caller-controlled GUC must not enable the privileged summary exception.
SELECT set_config('crm.semantic_parent_client',test_id(6007)::text,true);
UPDATE client_requests SET notes='Ordinary employee edit',priority=3,updated_at=now()+interval '1 minute' WHERE client_id=test_id(6007) AND request_type='buyer';
SELECT test_assert((SELECT client_type='buyer' FROM clients WHERE id=test_id(6007)),'authenticated caller spoofed semantic preservation context');
SELECT set_config('crm.semantic_parent_client','',true);
SELECT set_config('test.actor',test_id(12)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(6300),test_id(6314),test_id(6315))),'Barka sees Muscat/private semantic evidence');
SELECT set_config('test.actor',test_id(13)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(6314),test_id(6315))),'manager sees private semantic evidence');
SELECT set_config('test.actor',test_id(14)::text,true);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_message_attributions WHERE message_id IN(test_id(6314),test_id(6315))),'viewer sees private semantic evidence');
SELECT set_config('test.actor',test_id(10)::text,true);
SELECT test_assert((SELECT count(*) FROM property_message_attributions WHERE message_id IN(test_id(6314),test_id(6315)))=2,'owner lost private semantic evidence');
RESET ROLE;
SELECT 'Semantic inquiry provenance, idempotence, timestamps, branch and owner-only isolation passed' AS result;
ROLLBACK;
