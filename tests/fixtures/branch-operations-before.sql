-- ISOLATED full catalog only, after SQL30. Dates/numbers/identities are synthetic.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_branch31(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_branch31 TO authenticated;
CREATE FUNCTION test_branch31_metric(payload jsonb,branch text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT row FROM jsonb_array_elements(payload->'branches') row WHERE row->>'branch_key'=branch
$$;
CREATE FUNCTION test_branch31_business() RETURNS jsonb LANGUAGE sql AS $$
 SELECT test_coherence28_business()||jsonb_build_object(
  'requests',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM client_requests t),
  'profiles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM profiles t),
  'routes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM company_lead_routes t))
$$;
-- Construction bypasses write triggers solely to model already-recorded history
-- under two different authors. Constraints remain enabled; ordinary RLS/triggers
-- are restored before executing any API or authorization assertion.
SET session_replication_role=replica;
INSERT INTO auth.users(id,email) VALUES(test_id(32000),'synthetic-second-muscat@example.test');
INSERT INTO profiles(id,company_id,full_name,email,role,is_active)
VALUES(test_id(32000),test_id(1),'Synthetic second Muscat author','synthetic-second-muscat@example.test','agent',true);
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route)
VALUES(test_id(32020),test_id(1),test_id(11),'Synthetic shared Muscat client','+96800032020','muscat'),
 (test_id(32021),test_id(1),test_id(32000),'Synthetic second Muscat client','+96800032021','muscat');
INSERT INTO properties(id,company_id,added_by,sourced_by,title,type,area,price,branch_key,status,created_at)
VALUES(test_id(32010),test_id(1),test_id(11),test_id(11),'Synthetic former author listing','villa','Synthetic Muscat',80000,'muscat','sold','2022-10-02 00:00+04'),
 (test_id(32011),test_id(1),test_id(32000),test_id(32000),'Synthetic second author listing','villa','Synthetic Muscat',80000,'muscat','available','2022-10-03 00:00+04'),
 (test_id(32012),test_id(1),test_id(32000),test_id(32000),'Synthetic original attribution preserved','villa','Synthetic Muscat',80000,'muscat','available','2022-09-03 00:00+04');
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
VALUES(test_id(32050),test_id(1),test_id(32020),test_id(11),'muscat','synthetic-branch31-muscat','96800032020','+96800032020');
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp,delivery_status,sent_by_user_id,actor_type,channel_source)
VALUES(test_id(32040),test_id(1),test_id(32050),test_id(32020),'wamid.synthetic.branch31.one','outbound','Synthetic former author reply','2022-10-05 10:00+04','sent',test_id(11),'human','manual'),
 (test_id(32041),test_id(1),test_id(32050),test_id(32020),'wamid.synthetic.branch31.two','outbound','Synthetic second author reply','2022-10-05 10:05+04','sent',test_id(32000),'human','manual');
INSERT INTO activities(id,company_id,user_id,client_id,type,description,actor_type,outcome,occurred_at,created_at)
VALUES(test_id(32045),test_id(1),test_id(11),test_id(32020),'call','Synthetic documented contact','human','no answer','2022-10-05 10:00+04','2022-10-05 10:00+04'),
 (test_id(32046),test_id(1),test_id(32000),test_id(32020),'call','Synthetic second documented contact','human','requested visit','2022-10-05 11:00+04','2022-10-05 11:00+04');
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,created_by,created_at)
VALUES(test_id(32060),test_id(1),test_id(32020),test_id(32010),test_id(11),'2022-10-06','done',test_id(11),'2022-10-05 11:00+04'),
 (test_id(32061),test_id(1),test_id(32021),test_id(32011),test_id(32000),'2022-10-07','done',test_id(32000),'2022-10-05 11:00+04');
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,closed_at,deposit_amount,reservation_confirmed_at,
 reservation_evidence_note,expected_company_commission_at_reservation,reservation_cancelled_at,reservation_cancellation_reason,commission_total)
VALUES(test_id(32070),test_id(1),test_id(32020),test_id(32010),test_id(11),'closed','2022-11-04 12:00+04',100,'2022-10-15 00:00+04','Synthetic known actual payment',2000,NULL,NULL,2000),
 (test_id(32071),test_id(1),test_id(32021),test_id(32011),test_id(32000),'deposit',NULL,100,'2022-10-31 23:59:59+04','Synthetic known actual payment',2500,'2022-11-05 00:00+04','Synthetic cancellation',2500),
 (test_id(32072),test_id(1),test_id(102),test_id(300),test_id(11),'deposit',NULL,100,'2022-10-20 00:00+04','Synthetic private payment',999999,NULL,NULL,999999);
INSERT INTO crm_repair_private.deal_commission_receipts(company_id,deal_id,operation_key,received_on,amount,source_note,actor_id)
VALUES(test_id(1),test_id(32070),test_id(32080),'2022-11-04',500.125,'Synthetic partial receipt',test_id(10)),
 (test_id(1),test_id(32072),test_id(32081),'2022-11-04',999999,'Synthetic private receipt',test_id(10));
INSERT INTO employee_monthly_targets(company_id,employee_id,month_start,inventory_target,weekly_new_properties_target,daily_followups_target,
 weekly_viewings_target,reservations_target,booking_commission_target)
VALUES(test_id(1),test_id(11),'2022-10-01',0,2,NULL,5,0,5000.005);
SET session_replication_role=origin;
INSERT INTO test_branch31 VALUES('business_before',test_branch31_business());
INSERT INTO test_branch31 SELECT 'legacy_functions_before',jsonb_agg(jsonb_build_object('id',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
FROM pg_proc p WHERE p.oid IN ('public.crm_employee_performance(date,date)'::regprocedure,'public.crm_employee_target_snapshot()'::regprocedure,'crm_repair_private.performance_employee(uuid,text,timestamptz,uuid)'::regprocedure,'crm_repair_private.deal_period_metrics(date,date)'::regprocedure);
INSERT INTO test_branch31 SELECT 'trigger_before',jsonb_build_object('definition',pg_get_triggerdef(oid,true),'enabled',tgenabled)
FROM pg_trigger WHERE tgrelid='public.properties'::regclass AND tgname='zzzz_property_branch_employee';
INSERT INTO test_branch31 SELECT 'viewing_function_before',jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner)
FROM pg_proc p WHERE p.oid='public.crm_save_viewing_atomic(jsonb,uuid)'::regprocedure;
