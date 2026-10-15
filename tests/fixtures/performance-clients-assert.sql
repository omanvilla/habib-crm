-- Synthetic full-catalog tests; every added business row is rolled back.
DO $$DECLARE saved record;actual jsonb;BEGIN
 FOR saved IN SELECT * FROM test_performance_clients_rows LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',saved.table_name) INTO actual USING saved.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM saved.row_data,'SQL23 changed business row: '||saved.table_name);
 END LOOP;
 PERFORM test_assert((SELECT proacl::text IS NOT DISTINCT FROM b.acl AND proowner=b.owner_id FROM pg_proc p CROSS JOIN test_performance_clients_catalog b WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure),'SQL23 changed function ownership/ACL');
 PERFORM test_assert(NOT has_table_privilege('authenticated','crm_repair_private.performance_clients_backup_20261015','SELECT'),'SQL23 backup exposed');
END$$;
SET ROLE authenticated;
DO $$DECLARE n integer;before_json jsonb;after_json jsonb;prior_metrics jsonb;new_metrics jsonb;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13,16] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  SELECT payload INTO before_json FROM test_performance_clients_before WHERE actor=n;
  after_json:=crm_employee_performance(NULL,'2027-01-01');
  SELECT jsonb_agg(value ORDER BY value->>'employee_id') INTO prior_metrics FROM jsonb_array_elements(before_json->'employees');
  SELECT jsonb_agg(value-'inquiry_clients'-'replied_inquiry_clients'-'successful_staff_messages' ORDER BY value->>'employee_id') INTO new_metrics FROM jsonb_array_elements(after_json->'employees');
  PERFORM test_assert(before_json-'employees'=after_json-'employees' AND prior_metrics IS NOT DISTINCT FROM new_metrics,'existing performance counter changed for role '||n);
 END LOOP;
 PERFORM set_config('test.actor','',false);
 BEGIN PERFORM crm_employee_performance(NULL,'2027-01-01');RAISE EXCEPTION 'unauthenticated KPI access expanded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('test.actor',test_id(14)::text,false);
 BEGIN PERFORM crm_employee_performance(NULL,'2027-01-01');RAISE EXCEPTION 'viewer KPI access expanded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);

BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO clients(id,company_id,assigned_to,name,client_type,lead_route)
SELECT test_id(7000+n),test_id(CASE WHEN n=11 THEN 2 ELSE 1 END),test_id(CASE WHEN n=6 THEN 12 WHEN n=7 THEN 10 WHEN n=11 THEN 16 ELSE 11 END),
 'Synthetic period client '||n,CASE WHEN n=7 THEN 'investor' ELSE 'buyer' END,CASE WHEN n=6 THEN 'barka' WHEN n=7 THEN 'investment' ELSE 'muscat' END
 FROM generate_series(0,12)n;
INSERT INTO properties(id,company_id,title,branch_key,sourced_by,owner_client_id,status,archived,created_at,area,price)
VALUES(test_id(7030),test_id(1),'Second synthetic ordinary property','muscat',test_id(11),NULL,'available',false,'2026-01-01','الخوض',100000),
(test_id(7031),test_id(1),'Synthetic private owner property','muscat',test_id(11),test_id(102),'available',false,'2026-01-01','الخوض',100000),
(test_id(7032),test_id(2),'Synthetic other company property','muscat',test_id(16),NULL,'available',false,'2026-01-01','الخوض',100000);
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
SELECT test_id(7100+n),test_id(CASE WHEN n=11 THEN 2 ELSE 1 END),test_id(7000+n),
 test_id(CASE WHEN n=6 THEN 12 WHEN n=7 THEN 10 WHEN n=11 THEN 16 ELSE 11 END),
 CASE WHEN n=6 THEN 'barka' WHEN n=7 THEN 'investment' ELSE 'muscat' END,'synthetic-metric-phone','synthetic-period-client-'||n,'+9689110'||lpad(n::text,4,'0')
 FROM generate_series(0,12)n;
INSERT INTO property_inquiries(id,company_id,client_id,property_id,assigned_to,source,status,has_inbound_inquiry,first_inquiry_at,last_inquiry_at)
VALUES(test_id(7500),test_id(1),test_id(7000),test_id(300),test_id(11),'whatsapp','inquiry',true,'2026-09-01','2026-10-15'),
(test_id(7504),test_id(1),test_id(7004),test_id(300),test_id(11),'other','viewed',false,'2026-10-10','2026-10-10');
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,archived)
VALUES(test_id(7604),test_id(1),test_id(7004),test_id(300),test_id(11),'2026-10-10','done',false);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,request_id) VALUES
(test_id(7200),test_id(1),test_id(7100),test_id(7000),'wamid.period-7200','inbound','Synthetic inquiry','2026-09-01 10:00+00','customer',NULL),
(test_id(7201),test_id(1),test_id(7100),test_id(7000),'wamid.period-7201','inbound','Synthetic inquiry','2026-09-30 20:00+00','customer',NULL),
(test_id(7202),test_id(1),test_id(7100),test_id(7000),'wamid.period-7202','inbound','Synthetic inquiry','2026-10-15 10:00+00','customer',NULL),
(test_id(7203),test_id(1),test_id(7101),test_id(7001),'wamid.period-7203','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7204),test_id(1),test_id(7102),test_id(7002),'wamid.period-7204','inbound','Synthetic inquiry','2026-10-31 19:59:59+00','customer',NULL),
(test_id(7205),test_id(1),test_id(7106),test_id(7006),'wamid.period-7205','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7206),test_id(1),test_id(7107),test_id(7007),'wamid.period-7206','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7207),test_id(1),test_id(7108),test_id(7008),'wamid.period-7207','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',test_id(206)),
(test_id(7208),test_id(1),test_id(7109),test_id(7009),'wamid.period-7208','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7209),test_id(1),test_id(7110),test_id(7010),'wamid.period-7209','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7210),test_id(1),test_id(7112),test_id(7012),'wamid.period-7210','inbound','Synthetic inquiry','2026-10-31 20:00+00','customer',NULL),
(test_id(7211),test_id(1),test_id(7112),test_id(7012),'wamid.period-7211','inbound','Synthetic inquiry','2026-09-30 19:59:59+00','customer',NULL),
(test_id(7212),test_id(1),test_id(7103),test_id(7003),'wamid.period-7212','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7213),test_id(1),test_id(7104),test_id(7004),'wamid.period-7213','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL),
(test_id(7214),test_id(1),test_id(7105),test_id(7005),'wamid.period-7214','inbound','Synthetic inquiry','2026-09-20 10:00+00','customer',NULL),
(test_id(7215),test_id(2),test_id(7111),test_id(7011),'wamid.period-7215','inbound','Synthetic inquiry','2026-10-10 10:00+00','customer',NULL);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,delivery_status,actor_type,channel_source,reply_to_message_id,raw_payload,request_id,matched_property_id,sent_by_user_id) VALUES
(test_id(7300),test_id(1),test_id(7100),test_id(7000),'wamid.period-7300','outbound','Synthetic staff message','2026-09-30 20:01+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7301),test_id(1),test_id(7100),test_id(7000),'wamid.period-7301','outbound','Synthetic staff message','2026-10-01 10:00+00','read','human','whatsapp_business_app',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7302),test_id(1),test_id(7101),test_id(7001),'wamid.period-7302','outbound','Synthetic staff message','2026-10-09 10:00+00','delivered','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7303),test_id(1),test_id(7101),test_id(7001),'wamid.period-7303','outbound','Synthetic staff message','2026-10-10 11:00+00','failed','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7304),test_id(1),test_id(7101),test_id(7001),'wamid.period-7304','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','automated','crm_automation',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7305),test_id(1),test_id(7105),test_id(7005),'wamid.period-7305','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7306),test_id(1),test_id(7106),test_id(7006),'wamid.period-7306','outbound','Synthetic staff message','2026-10-10 11:00+00','delivered','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(12)),
(test_id(7307),test_id(1),test_id(7107),test_id(7007),'wamid.period-7307','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7308),test_id(1),test_id(7108),test_id(7008),'wamid.period-7308','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm',NULL,'{}'::jsonb,test_id(206),NULL,test_id(11)),
(test_id(7309),test_id(1),test_id(7109),test_id(7009),'wamid.period-7309','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm',NULL,'{}'::jsonb,NULL,test_id(7031),test_id(11)),
(test_id(7311),test_id(2),test_id(7111),test_id(7011),'wamid.period-7311','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(16)),
(test_id(7312),test_id(1),test_id(7100),test_id(7000),'wamid.period-7312','outbound','Synthetic staff message','2026-09-30 19:59:59+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7313),test_id(1),test_id(7100),test_id(7000),'wamid.period-7313','outbound','Synthetic staff message','2026-10-31 20:00+00','sent','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7314),test_id(1),test_id(7101),test_id(7001),'wamid.period-7314','outbound','Synthetic staff message','2026-10-10 11:00+00','sent','human','crm','wamid.unrelated','{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7315),test_id(1),test_id(7102),test_id(7002),'wamid.period-7315','outbound','Synthetic staff message','2026-10-31 19:59:59+00','sent','human','crm_automation',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7316),test_id(1),test_id(7102),test_id(7002),'wamid.period-7316','outbound','Synthetic staff message','2026-10-31 19:59:59+00','sent','human','crm',NULL,'{"source": "property_details_auto_reply"}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7317),test_id(1),test_id(7102),test_id(7002),'wamid.period-7317','outbound','Synthetic staff message','2026-10-31 19:59:59+00','sent','human','crm',NULL,'{"is_automated": true}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7318),test_id(1),test_id(7102),test_id(7002),'wamid.period-7318','outbound','Synthetic staff message','2026-10-31 19:59:59+00','queued','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7319),test_id(1),test_id(7102),test_id(7002),'wamid.period-7319','outbound','Synthetic staff message','2026-10-31 19:59:59+00',NULL,'human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7320),test_id(1),test_id(7102),test_id(7002),'wamid.period-7320','outbound','Synthetic staff message','2026-10-31 19:59:59+00','rejected','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11)),
(test_id(7321),test_id(1),test_id(7102),test_id(7002),'wamid.period-7321','outbound','Synthetic staff message','2026-10-31 19:59:59+00','undelivered','human','crm',NULL,'{}'::jsonb,NULL,NULL,test_id(11));
INSERT INTO property_message_attributions(id,company_id,message_id,client_id,property_id,inquiry_id,request_id,evidence_key,method) VALUES
(test_id(7400),test_id(1),test_id(7200),test_id(7000),test_id(300),test_id(7500),NULL,'synthetic-period-7200','manual'),
(test_id(7401),test_id(1),test_id(7201),test_id(7000),test_id(300),test_id(7500),NULL,'synthetic-period-7201','manual'),
(test_id(7402),test_id(1),test_id(7202),test_id(7000),test_id(300),test_id(7500),NULL,'synthetic-period-7202','manual'),
(test_id(7403),test_id(1),test_id(7203),test_id(7001),test_id(300),NULL,NULL,'synthetic-period-7203','manual'),
(test_id(7404),test_id(1),test_id(7204),test_id(7002),test_id(300),NULL,NULL,'synthetic-period-7204','manual'),
(test_id(7405),test_id(1),test_id(7205),test_id(7006),test_id(301),NULL,NULL,'synthetic-period-7205','manual'),
(test_id(7406),test_id(1),test_id(7206),test_id(7007),test_id(300),NULL,NULL,'synthetic-period-7206','manual'),
(test_id(7407),test_id(1),test_id(7207),test_id(7008),test_id(300),NULL,test_id(206),'synthetic-period-7207','manual'),
(test_id(7408),test_id(1),test_id(7208),test_id(7009),test_id(7031),NULL,NULL,'synthetic-period-7208','manual'),
(test_id(7409),test_id(1),test_id(7209),test_id(7010),test_id(301),NULL,NULL,'synthetic-period-7209','manual'),
(test_id(7410),test_id(1),test_id(7210),test_id(7012),test_id(300),NULL,NULL,'synthetic-period-7210','manual'),
(test_id(7411),test_id(1),test_id(7211),test_id(7012),test_id(300),NULL,NULL,'synthetic-period-7211','manual'),
(test_id(7414),test_id(1),test_id(7214),test_id(7005),test_id(300),NULL,NULL,'synthetic-period-7214','manual'),
(test_id(7415),test_id(2),test_id(7215),test_id(7011),test_id(7032),NULL,NULL,'synthetic-period-7215','manual'),
(test_id(7490),test_id(1),test_id(7203),test_id(7001),test_id(7030),NULL,NULL,'synthetic-second-property','manual');
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer;e jsonb;result jsonb;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  result:=crm_employee_performance('2026-10-01','2026-11-01');
  SELECT value INTO e FROM jsonb_array_elements(result->'employees') WHERE value->>'employee_id'=test_id(11)::text;
  PERFORM test_assert((e->>'inquiry_clients')::int=3,'unique inquirers/repeat or multi-property dedupe/privacy failed for role '||n||': '||e);
  PERFORM test_assert((e->>'replied_inquiry_clients')::int=1,'reply ordering/automation/private/unrelated quote changed response count for role '||n||': '||e);
  PERFORM test_assert((e->>'successful_staff_messages')::int=5,'successful staff sent-volume wrong for role '||n||': '||e);
  IF n=11 THEN
   PERFORM test_assert(jsonb_array_length(result->'employees')=1,'Muscat report exposes other employee');
  ELSE
   SELECT value INTO e FROM jsonb_array_elements(result->'employees') WHERE value->>'employee_id'=test_id(12)::text;
   PERFORM test_assert((e->>'inquiry_clients')::int=1 AND (e->>'replied_inquiry_clients')::int=1 AND (e->>'successful_staff_messages')::int=1,'Barka aggregate wrong for elevated role '||n);
  END IF;
 END LOOP;
 PERFORM set_config('test.actor',test_id(12)::text,true);
 result:=crm_employee_performance('2026-10-01','2026-11-01');e:=result->'employees'->0;
 PERFORM test_assert(jsonb_array_length(result->'employees')=1 AND e->>'employee_id'=test_id(12)::text,'Barka report exposes other employee');
 PERFORM test_assert((e->>'inquiry_clients')::int=1 AND (e->>'replied_inquiry_clients')::int=1 AND (e->>'successful_staff_messages')::int=1,'Barka sees opposite-branch/private evidence');
 PERFORM set_config('test.actor',test_id(11)::text,true);
 e:=crm_employee_performance('2026-10-01','2026-10-02')->'employees'->0;
 PERFORM test_assert((e->>'inquiry_clients')::int=1 AND (e->>'successful_staff_messages')::int=2,'Oman start-of-month timestamp wrong');
 e:=crm_employee_performance('2026-10-31','2026-11-01')->'employees'->0;
 PERFORM test_assert((e->>'inquiry_clients')::int=1 AND (e->>'replied_inquiry_clients')::int=0 AND (e->>'successful_staff_messages')::int=0,'exclusive end boundary / failed-only reply wrong');
 e:=crm_employee_performance('2026-11-01','2026-11-02')->'employees'->0;
 PERFORM test_assert((e->>'inquiry_clients')::int=1 AND (e->>'successful_staff_messages')::int=1,'next-period boundary lost');
 PERFORM set_config('test.actor',test_id(16)::text,true);
 PERFORM test_assert(jsonb_array_length(crm_employee_performance('2026-10-01','2026-11-01')->'employees')=0,'another company saw team results');
END$$;
RESET ROLE;
-- A genuine explicit reply counts its client once, regardless of how many
-- properties the original inquiry referenced or how many replies are sent.
SET LOCAL session_replication_role=replica;
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,delivery_status,actor_type,channel_source,reply_to_message_id,sent_by_user_id)
VALUES(test_id(7350),test_id(1),test_id(7101),test_id(7001),'wamid.period-7350','outbound','Actual quoted reply','2026-10-10 12:00+00','sent','human','crm','wamid.period-7203',test_id(11)),
(test_id(7351),test_id(1),test_id(7101),test_id(7001),'wamid.period-7351','outbound','Actual quoted UUID reply','2026-10-10 12:01+00','sent','human','crm',test_id(7203)::text,test_id(11));
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,true);
SELECT test_assert((crm_employee_performance('2026-10-01','2026-11-01')->'employees'->0->>'replied_inquiry_clients')::int=2,'quoted reply not counted or duplicate replies double-counted client');
SELECT test_assert((crm_employee_performance('2026-10-01','2026-11-01')->'employees'->0->>'successful_staff_messages')::int=7,'quoted human messages missing from successful sent volume');
RESET ROLE;
ROLLBACK;
