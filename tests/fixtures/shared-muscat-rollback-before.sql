-- ISOLATED SYNTHETIC DATABASE ONLY. Save a genuinely new private message after
-- SQL32 so rollback must preserve work written under the new receiving policy.
RESET ROLE;
SELECT set_config('test.actor','',false);
SET ROLE service_role;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone,unread_count)
VALUES(test_id(39400),test_id(1),test_id(106),test_id(11),'muscat','synthetic-muscat','96891100106','+96891100106',0);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,channel_source)
VALUES(test_id(39401),test_id(1),test_id(39400),test_id(106),'wamid.synthetic.shared-muscat-rollback','inbound',
 'PRIVATE POST-RELEASE HISTORY SENTINEL','2026-10-20 13:00+04','customer','whatsapp');
INSERT INTO activities(id,company_id,user_id,client_id,type,description,actor_type,direction,channel,occurred_at,after_data)
VALUES(test_id(39401),test_id(1),test_id(10),test_id(106),'note','PRIVATE POST-RELEASE ACTIVITY','system','inbound','whatsapp','2026-10-20 13:00+04',
 jsonb_build_object('conversation_id',test_id(39400),'message_id',test_id(39401),'route_key','investment','source_actor_type','customer'));
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT route_key='investment' AND assigned_to=test_id(10) AND meta_phone_number_id='synthetic-muscat'
 FROM whatsapp_conversations WHERE id=test_id(39400)),'rollback fixture saves real post-release private history on the shared physical line');
INSERT INTO test_shared32 VALUES('business_for_rollback',test_coherence28_business());
INSERT INTO test_shared32 SELECT 'routes_for_rollback',jsonb_agg(to_jsonb(r) ORDER BY id) FROM company_lead_routes r;
SELECT test_reservation_assert((SELECT value FROM test_shared32 WHERE key='business_for_rollback')
 IS DISTINCT FROM (SELECT value FROM test_shared32 WHERE key='business_before'),'rollback preservation includes newly written work, not just an empty schema');
