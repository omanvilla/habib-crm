-- Dedicated synthetic database cloned after SQL28. No production/test backend
-- connection is used. Construct historical cross-line identities, then restore
-- ordinary triggers before exercising the real authenticated RLS and RPC.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_staff_volume30(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_staff_volume30 TO authenticated;
CREATE FUNCTION test_staff_volume30_metric(p jsonb,e uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT row FROM jsonb_array_elements(p->'employees')row WHERE row->>'employee_id'=e::text
$$;
CREATE FUNCTION test_staff_volume30_business() RETURNS jsonb LANGUAGE sql AS $$
 SELECT test_coherence28_business()||jsonb_build_object('requests',
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM client_requests t))
$$;
CREATE FUNCTION test_staff_volume30_visibility() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'clients',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM clients WHERE id>=test_id(30000) AND id<test_id(30100)),
  'requests',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM client_requests WHERE id>=test_id(30000) AND id<test_id(30100)),
  'conversations',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM whatsapp_conversations WHERE id>=test_id(30000) AND id<test_id(30100)),
  'messages',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM whatsapp_messages WHERE id>=test_id(30000) AND id<test_id(30100)),
  'inquiries',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM property_inquiries WHERE id>=test_id(30000) AND id<test_id(30100)),
  'attributions',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM property_message_attributions WHERE id>=test_id(30000) AND id<test_id(30100)))
$$;
CREATE FUNCTION test_staff_volume30_security() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'policies',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tablename,policyname) FROM pg_policies t WHERE schemaname='public'),
  'functions',(SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
    'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','crm_repair_private') AND p.prokind='f'
    AND p.oid<>'public.crm_employee_performance(date,date)'::regprocedure),
  'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,'owner',c.relowner,
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v')))
$$;
SET ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  INSERT INTO test_staff_volume30 VALUES('baseline_'||n,crm_employee_performance('2026-10-01','2026-11-01'));
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
-- Replication mode is confined to synthetic historical fixture construction.
SET session_replication_role=replica;
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route)
VALUES(test_id(30000),test_id(1),test_id(11),'Synthetic Muscat primary for Barka line','+96800030000','muscat'),
 (test_id(30001),test_id(1),test_id(12),'Synthetic Barka primary for Muscat line','+96800030001','barka'),
 (test_id(30002),test_id(1),NULL,'Synthetic unassigned general primary','+96800030002','general'),
 (test_id(30003),test_id(1),test_id(11),'Synthetic ordinary shared parent','+96800030003','muscat');
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to)
VALUES(test_id(30070),test_id(1),test_id(30003),'investor','investment','investment',test_id(10));
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
SELECT test_id(n),test_id(1),test_id(cid),test_id(assignee),route,'synthetic-sql30-'||route,'968000'||cid,'+968000'||cid
FROM (VALUES
 (30010,30001,12,'muscat'),(30011,30000,11,'barka'),(30012,30002,NULL,'barka'),
 (30013,30003,11,'muscat'),(30014,30003,10,'investment'),(30015,102,11,'muscat'),
 (30016,30001,12,'barka'))f(n,cid,assignee,route);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,request_id,whatsapp_message_id,
 direction,body,message_timestamp,delivery_status,sent_by_user_id,actor_type,channel_source,raw_payload)
SELECT test_id(n),test_id(1),test_id(conv),test_id(cid),test_id(req),'wamid.synthetic-sql30-'||n,
 'outbound','Synthetic SQL30 message','2026-10-05 10:00+00',delivery,test_id(sender),actor,channel,raw
FROM (VALUES
 (30020,30010,30001,NULL,'read',11,'human','manual','{}'::jsonb),
 (30021,30011,30000,NULL,'delivered',12,'human','manual','{}'::jsonb),
 (30022,30012,30002,NULL,'sent',12,'human','manual','{}'::jsonb),
 (30023,30013,30003,NULL,'sent',11,'human','manual','{}'::jsonb),
 (30024,30016,30001,NULL,'sent',12,'human','manual','{}'::jsonb),
 (30025,30013,30003,NULL,'failed',11,'human','manual','{}'::jsonb),
 (30026,30013,30003,NULL,'queued',11,'human','manual','{}'::jsonb),
 (30027,30013,30003,NULL,'sent',11,'automated','manual','{}'::jsonb),
 (30028,30013,30003,NULL,'sent',11,'human','crm_followup','{}'::jsonb),
 (30029,30013,30003,NULL,'sent',11,'human','manual','{"source":"auto_reply"}'::jsonb),
 (30030,30013,30003,NULL,'sent',11,'human','manual','{"is_automated":"true"}'::jsonb),
 (30031,30013,30003,NULL,'sent',11,'human','manual','{"actor_type":"automated"}'::jsonb),
 (30032,30013,30003,NULL,'sent',11,'human','manual','{"automated":"1"}'::jsonb),
 (30033,30013,30003,30070,'sent',11,'human','manual','{}'::jsonb),
 (30034,30014,30003,30070,'sent',11,'human','manual','{}'::jsonb),
 (30035,30015,102,NULL,'sent',11,'human','manual','{}'::jsonb),
 (30036,30010,30000,NULL,'sent',11,'human','manual','{}'::jsonb),
 (30037,30013,30003,NULL,NULL,11,'human','manual','{}'::jsonb)
)f(n,conv,cid,req,delivery,sender,actor,channel,raw);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp)
VALUES(test_id(30060),test_id(1),test_id(30010),test_id(30001),'wamid.synthetic-sql30-30060','inbound','Synthetic cross-line property inquiry','2026-10-05 09:00+00');
INSERT INTO property_inquiries(id,company_id,client_id,property_id,assigned_to,source,first_inquiry_at,last_inquiry_at,has_inbound_inquiry,source_whatsapp_message_id)
-- Preserve the primary client's original assignee. Explicitly assigning an
-- inquiry to the line employee would permit that row under the existing RLS;
-- inquiry_evidence still separately requires client access in either case.
VALUES(test_id(30080),test_id(1),test_id(30001),test_id(300),test_id(12),'whatsapp','2026-10-05 09:00+00','2026-10-05 09:00+00',true,test_id(30060));
INSERT INTO property_message_attributions(id,company_id,message_id,client_id,property_id,inquiry_id,evidence_key,method)
VALUES(test_id(30090),test_id(1),test_id(30060),test_id(30001),test_id(300),test_id(30080),'synthetic-sql30-cross-line','exact_code');
SET session_replication_role=origin;
SET ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  INSERT INTO test_staff_volume30 VALUES('before_'||n,crm_employee_performance('2026-10-01','2026-11-01'));
  INSERT INTO test_staff_volume30 VALUES('visibility_before_'||n,test_staff_volume30_visibility());
 END LOOP;
END $$;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(30020))
 AND EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(30010)),
 'SQL30 predecessor RLS already exposes the own-line conversation/message despite stale other-branch assignment');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(30001))
 AND NOT EXISTS(SELECT 1 FROM property_inquiries WHERE id=test_id(30080)),
 'SQL30 predecessor still hides the opposite-primary client and linked inquiry');
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM property_message_attributions WHERE id=test_id(30090)),
 'Existing attribution RLS already follows the visible message; SQL30 must preserve that access without granting client/inquiry evidence');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(
 (test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='before_10'),test_id(11))->>'successful_staff_messages')::int
 =(test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='baseline_10'),test_id(11))->>'successful_staff_messages')::int+2
 AND (test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='before_11'),test_id(11))->>'successful_staff_messages')::int
 =(test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='baseline_11'),test_id(11))->>'successful_staff_messages')::int+1,
 'SQL30 reproduces owner/self undercount for authorized Muscat-line work on a Barka-primary client');
SELECT test_reservation_assert(
 (test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='before_10'),test_id(12))->>'successful_staff_messages')::int
 =(test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='baseline_10'),test_id(12))->>'successful_staff_messages')::int+3
 AND (test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='before_12'),test_id(12))->>'successful_staff_messages')::int
 =(test_staff_volume30_metric((SELECT value FROM test_staff_volume30 WHERE key='baseline_12'),test_id(12))->>'successful_staff_messages')::int+1,
 'SQL30 reproduces Barka undercount for both opposite-primary and unassigned general clients');
DO $$ DECLARE field text;owner_before jsonb;owner_baseline jsonb;self_before jsonb;self_baseline jsonb;BEGIN
 SELECT test_staff_volume30_metric(value,test_id(11)) INTO owner_before FROM test_staff_volume30 WHERE key='before_10';
 SELECT test_staff_volume30_metric(value,test_id(11)) INTO owner_baseline FROM test_staff_volume30 WHERE key='baseline_10';
 SELECT test_staff_volume30_metric(value,test_id(11)) INTO self_before FROM test_staff_volume30 WHERE key='before_11';
 SELECT test_staff_volume30_metric(value,test_id(11)) INTO self_baseline FROM test_staff_volume30 WHERE key='baseline_11';
 FOREACH field IN ARRAY ARRAY['inquiry_clients','inquiry_property_pairs','replied_inquiry_clients'] LOOP
  PERFORM test_reservation_assert((owner_before->>field)::int=(owner_baseline->>field)::int+1
   AND self_before->field=self_baseline->field,
   'Client-scoped inquiry evidence remains owner-only for this cross-primary case: '||field);
 END LOOP;
END $$;
INSERT INTO test_staff_volume30 VALUES
 ('business_before',test_staff_volume30_business()),
 ('security_before',test_staff_volume30_security()),
 ('function_before',to_jsonb(pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure))),
 ('function_metadata_before',(SELECT jsonb_build_object('acl',proacl,'owner',proowner) FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure));
