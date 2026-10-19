-- Synthetic isolated catalog ONLY. Tests make isolated records, then ROLLBACK
-- them so the earlier SQL25/26/27 preservation assertions remain meaningful.
BEGIN;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_coherence28 WHERE key='business_before'),
 'SQL28 and repeat application preserve every existing business row');
SELECT test_reservation_assert((SELECT to_jsonb(definition)=(SELECT value FROM test_coherence28 WHERE key='function_before')
 FROM crm_repair_private.audit28_catalog_backup WHERE kind='function'),'SQL28 repeat keeps exact predecessor function backup');
SELECT test_reservation_assert((SELECT to_jsonb(definition)=(SELECT value FROM test_coherence28 WHERE key='view_before')
 FROM crm_repair_private.audit28_catalog_backup WHERE kind='view'),'SQL28 repeat keeps exact protected view backup');
SELECT test_reservation_assert((SELECT to_jsonb(relacl) FROM pg_class WHERE oid='public.crm_deals_access'::regclass)
 =(SELECT value FROM test_coherence28 WHERE key='view_acl_before'),'view replacement preserves its exact access grants');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(d)-ARRAY['reservation_confirmed_at','reservation_cancelled_at'] ORDER BY id),'[]'::jsonb) FROM crm_deals_access d)
 =(SELECT value FROM test_coherence28 WHERE key='view_rows_before'),'only the two safe dates are added to existing deal projections');
SELECT test_reservation_assert(crm_employee_target_snapshot()=(SELECT value FROM test_coherence28 WHERE key='targets_before'),
 'SQL28 changes no target value, target count or target detail ID');
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(crm_employee_performance('2026-08-01','2026-11-01')->'employees')a
 JOIN jsonb_array_elements((SELECT value->'employees' FROM test_coherence28 WHERE key='performance_before'))b ON a->>'employee_id'=b->>'employee_id'
 WHERE a-ARRAY['active_inventory','new_properties','company_commission','visit_cohort_total','visit_cohort_done','visit_cohort_pending','visit_cohort_cancelled','followup_clients','sales_without_reservation','unknown_company_commission','inquiry_property_pairs','inquiry_pair_to_visit']
 IS DISTINCT FROM b-ARRAY['active_inventory','new_properties','company_commission']),
 'legacy inquiry/message/activity/sales/reservation keys retain their previous values');
INSERT INTO test_coherence28 VALUES('stock_baseline',test_coherence28_target()),('barka_stock_baseline',test_coherence28_target(test_id(12)));

-- Standing stock has no creation/price/creator gate; qualified additions have a
-- positive price, actual period and non-archived state even after a sale.
INSERT INTO properties(id,company_id,added_by,sourced_by,title,type,area,price,branch_key,status,archived,created_at,owner_client_id)
VALUES
 (test_id(28001),test_id(1),test_id(10),test_id(10),'Synthetic old zero price','villa','Synthetic Muscat',0,'muscat','available',false,'2020-01-01',NULL),
 (test_id(28002),test_id(1),test_id(10),test_id(10),'Synthetic qualified available','villa','Synthetic Muscat',80000,'muscat','available',false,now(),NULL),
 (test_id(28003),test_id(1),test_id(10),test_id(10),'Synthetic qualified sold','villa','Synthetic Muscat',80000,'muscat','sold',false,now(),NULL),
 (test_id(28004),test_id(1),test_id(10),test_id(10),'Synthetic archived','villa','Synthetic Muscat',80000,'muscat','available',true,now(),NULL),
 (test_id(28005),test_id(1),test_id(10),test_id(10),'Synthetic qualified reserved','villa','Synthetic Muscat',80000,'muscat','reserved',false,now(),NULL),
 (test_id(28006),test_id(1),test_id(10),test_id(10),'Synthetic private link','villa','Synthetic Muscat',80000,'muscat','available',false,now(),test_id(102)),
 (test_id(28007),test_id(1),test_id(10),test_id(10),'Synthetic Barka available','villa','Synthetic Barka',80000,'barka','available',false,now(),NULL),
 (test_id(28008),test_id(1),test_id(10),test_id(10),'Synthetic new zero price','villa','Synthetic Muscat',0,'muscat','available',false,now(),NULL);
SELECT test_reservation_assert((test_coherence28_target()->>'inventory')::int=(SELECT (value->>'inventory')::int+3 FROM test_coherence28 WHERE key='stock_baseline')
 AND (test_coherence28_target()->>'new_properties')::int=(SELECT (value->>'new_properties')::int+3 FROM test_coherence28 WHERE key='stock_baseline'),
 'old/zero-price whole stock and qualified current additions remain independent');
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')t
 JOIN jsonb_array_elements(crm_employee_performance((crm_employee_target_snapshot()->>'week_start')::date,(crm_employee_target_snapshot()->>'today')::date+1)->'employees')p ON t->>'id'=p->>'employee_id'
 WHERE t->'inventory' IS DISTINCT FROM p->'active_inventory' OR t->'new_properties' IS DISTINCT FROM p->'new_properties'),
 'performance standing stock and same-week qualified additions exactly match target counts for both branches');

INSERT INTO test_coherence28 VALUES('oct_baseline',test_coherence28_metric('2026-10-01','2026-11-01'));
-- Four completed plus one scheduled, with separate cancellation/no-show/postpone
-- cases. Creation dates deliberately fall in another month; actual visit day wins.
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,viewing_time,status,archived,created_at,created_by)
SELECT test_id(n),test_id(1),test_id(100),test_id(28002),test_id(10),day,'12:00',state,archived,created,test_id(10)
FROM (VALUES
 (28101,'2026-10-05'::date,'done',false,'2026-08-01 08:00+00'::timestamptz),
 (28102,'2026-10-06'::date,'done',false,'2026-08-01 08:00+00'::timestamptz),
 (28103,'2026-10-07'::date,'done',false,'2026-08-01 08:00+00'::timestamptz),
 (28104,'2026-10-08'::date,'done',false,'2026-08-01 08:00+00'::timestamptz),
 (28105,'2026-10-09'::date,'scheduled',false,'2026-08-01 08:00+00'::timestamptz),
 (28106,'2026-10-10'::date,'cancelled',false,'2026-08-01 08:00+00'::timestamptz),
 (28107,'2026-10-11'::date,'no_show',false,'2026-08-01 08:00+00'::timestamptz),
 (28108,'2026-10-12'::date,'postponed',false,'2026-08-01 08:00+00'::timestamptz),
 (28109,'2026-09-30'::date,'done',false,'2026-10-15 08:00+00'::timestamptz),
 (28110,'2026-11-01'::date,'done',false,'2026-10-15 08:00+00'::timestamptz),
 (28111,'2026-10-05'::date,'done',true,'2026-10-15 08:00+00'::timestamptz)
)cases(n,day,state,archived,created);
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,viewing_time,status,created_by)
VALUES(test_id(28112),test_id(1),test_id(101),test_id(28007),test_id(12),'2026-10-05','12:00','done',test_id(10)),
 (test_id(28113),test_id(1),test_id(102),test_id(28002),test_id(10),'2026-10-05','12:00','done',test_id(10));
SELECT test_reservation_assert((SELECT
 (m->>'visit_cohort_total')::int=(b.value->>'visit_cohort_total')::int+8
 AND (m->>'visit_cohort_done')::int=(b.value->>'visit_cohort_done')::int+4
 AND (m->>'visit_cohort_pending')::int=(b.value->>'visit_cohort_pending')::int+3
 AND (m->>'visit_cohort_cancelled')::int=(b.value->>'visit_cohort_cancelled')::int+1
 FROM test_coherence28 b, LATERAL test_coherence28_metric('2026-10-01','2026-11-01')m WHERE b.key='oct_baseline'),
 'visit cohort uses actual dates, includes every status once, excludes archived/private/opposite branch');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-11-01')->'employees')m
 WHERE (m->>'visit_cohort_total')::int<>(m->>'visit_cohort_done')::int+(m->>'visit_cohort_pending')::int+(m->>'visit_cohort_cancelled')::int),
 'every visit cohort partitions exactly into completed, incomplete and cancelled');
SELECT test_reservation_assert(test_coherence28_metric('2026-10-01','2026-11-01')->'inquiry_clients'=(SELECT value->'inquiry_clients' FROM test_coherence28 WHERE key='oct_baseline'),
 'manual visits never manufacture inbound inquiry clients');

-- Same returning customer asks again this month about two properties. The first
-- inquiry was last month; actual inbound anchors supply both new period pairs.
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp)
VALUES(test_id(28201),test_id(1),test_id(400),test_id(100),'wamid.synthetic-coherence-28201','inbound','Synthetic returning inquiry','2026-10-05 08:00+00'),
 (test_id(28202),test_id(1),test_id(400),test_id(100),'wamid.synthetic-coherence-28202','inbound','Synthetic repeated same inquiry','2026-10-06 08:00+00'),
 (test_id(28203),test_id(1),test_id(402),test_id(102),'wamid.synthetic-coherence-28203','inbound','Synthetic private inquiry','2026-10-05 08:00+00');
INSERT INTO property_inquiries(id,company_id,client_id,property_id,assigned_to,source,first_inquiry_at,last_inquiry_at,has_inbound_inquiry)
VALUES(test_id(28210),test_id(1),test_id(100),test_id(28002),test_id(11),'whatsapp','2026-09-01','2026-10-06',true),
 (test_id(28211),test_id(1),test_id(100),test_id(28003),test_id(11),'whatsapp','2026-09-01','2026-10-06',true)
ON CONFLICT(company_id,client_id,property_id) WHERE request_id IS NULL DO UPDATE SET has_inbound_inquiry=true,first_inquiry_at=EXCLUDED.first_inquiry_at,last_inquiry_at=EXCLUDED.last_inquiry_at;
INSERT INTO property_message_attributions(id,company_id,message_id,client_id,property_id,inquiry_id,evidence_key,method)
SELECT test_id(n),test_id(1),test_id(mid),test_id(cid),test_id(pid),(SELECT id FROM property_inquiries WHERE company_id=test_id(1) AND client_id=test_id(cid) AND property_id=test_id(pid) AND request_id IS NULL),n::text,'exact_code'
FROM (VALUES(28221,28201,100,28002),(28222,28201,100,28003),(28223,28202,100,28002),(28224,28203,102,28002)) cases(n,mid,cid,pid);
SELECT test_reservation_assert((SELECT
 (m->>'inquiry_clients')::int=(b.value->>'inquiry_clients')::int+1
 AND (m->>'inquiry_property_pairs')::int=(b.value->>'inquiry_property_pairs')::int+2
 AND (m->>'inquiry_pair_to_visit')::int=(b.value->>'inquiry_pair_to_visit')::int+1
 FROM test_coherence28 b,LATERAL test_coherence28_metric('2026-10-01','2026-11-01')m WHERE b.key='oct_baseline'),
 'returning inbound clients and property pairs use the same actual-message cohort, deduplicate repeats and match real visit dates');

-- The same human contacts one client twice: count one outcome client, not two
-- events. Record time differs from business event time; automation/notes do not count.
INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route)
VALUES(test_id(28301),test_id(1),test_id(11),'Synthetic contacted client','+96800028301','muscat'),
 (test_id(28302),test_id(1),test_id(11),'Synthetic outcome-less client','+96800028302','muscat');
INSERT INTO test_coherence28 VALUES('today_baseline',test_coherence28_metric((now() AT TIME ZONE 'Asia/Muscat')::date,(now() AT TIME ZONE 'Asia/Muscat')::date+1)),
 ('target_contact_baseline',test_coherence28_target());
INSERT INTO activities(id,company_id,user_id,client_id,type,actor_type,outcome,description,occurred_at,created_at)
VALUES(test_id(28311),test_id(1),test_id(10),test_id(28301),'followup','human','no reply','Synthetic human result',now(),now()-interval '2 months'),
 (test_id(28312),test_id(1),test_id(10),test_id(28301),'call','human','replied','Synthetic second result',now(),now()),
 (test_id(28313),test_id(1),test_id(10),test_id(28302),'followup','automated','sent','Synthetic automation',now(),now()),
 (test_id(28314),test_id(1),test_id(10),test_id(28302),'note','human','saved','Synthetic plain note',now(),now()),
 (test_id(28315),test_id(1),test_id(10),test_id(28302),'call','human',NULL,'Synthetic unknown result',now(),now()),
 (test_id(28316),test_id(1),test_id(10),test_id(102),'followup','human','replied','Synthetic private result',now(),now()),
 (test_id(28317),test_id(1),test_id(10),test_id(28302),'followup','human','replied','Synthetic previous-day result',((now() AT TIME ZONE 'Asia/Muscat')::date::timestamp AT TIME ZONE 'Asia/Muscat')-interval '1 microsecond',now());
SELECT test_reservation_assert((test_coherence28_metric((now() AT TIME ZONE 'Asia/Muscat')::date,(now() AT TIME ZONE 'Asia/Muscat')::date+1)->>'followup_clients')::int
 =(SELECT (value->>'followup_clients')::int+1 FROM test_coherence28 WHERE key='today_baseline')
 AND (test_coherence28_target()->>'followups')::int=(SELECT (value->>'followups')::int+1 FROM test_coherence28 WHERE key='target_contact_baseline'),
 'period contacts and daily goal share true human outcomes, unique clients and Oman-local event dates');

-- A completed sale with real commission but unknown payment date stays a sale;
-- it cannot silently invent a booking or target credit from its closing date.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,entry_mode,closed_at,commission_total,broker_commission,company_share,agent_share,commission_status,commission_received_at)
VALUES(test_id(28401),test_id(1),test_id(100),test_id(28002),test_id(10),'closed','historical','2026-10-03 08:00+00',2500,0,2000,500,'received','2026-10-07 08:00+00'),
 (test_id(28402),test_id(1),test_id(100),test_id(28003),test_id(10),'closed','historical','2026-10-03 08:00+00',NULL,NULL,NULL,NULL,'pending',NULL);
SELECT test_reservation_assert((SELECT
 (m->>'sales')::int=(b.value->>'sales')::int+2
 AND (m->>'sales_without_reservation')::int=(b.value->>'sales_without_reservation')::int+2
 AND (m->>'unknown_company_commission')::int=(b.value->>'unknown_company_commission')::int+1
 AND (m->>'company_commission')::numeric=(b.value->>'company_commission')::numeric+2500
 AND m->'reservations'=b.value->'reservations' AND m->'expected_commission'=b.value->'expected_commission'
 FROM test_coherence28 b,LATERAL test_coherence28_metric('2026-10-01','2026-11-01')m WHERE b.key='oct_baseline'),
 'closed sales use gross office commission before employee allocation, diagnose unknown amounts and never invent missing bookings');
SELECT test_reservation_assert((SELECT reservation_confirmed_at IS NULL AND reservation_cancelled_at IS NULL AND closed_at='2026-10-03 08:00+00'::timestamptz FROM crm_deals_access WHERE id=test_id(28401)),
 'deal lists expose unknown booking date as NULL while retaining known sale date');
SELECT test_reservation_assert((SELECT agent_share=500 AND company_share=2000 AND commission_total=2500 FROM deals WHERE id=test_id(28401)),
 'report gross correction never alters stored employee or company allocations');

-- Role and privacy checks on the additive projection and all new metric fields.
INSERT INTO test_coherence28 VALUES('owner_oct_final',crm_employee_performance('2026-10-01','2026-11-01'));
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_employee_performance('2026-10-01','2026-11-01')->'employees')=1,
 'Barka employee sees exactly one scoped performance row');
SELECT test_reservation_assert(crm_employee_performance('2026-10-01','2026-11-01')->'employees'->0=
 (SELECT m FROM test_coherence28 b CROSS JOIN LATERAL jsonb_array_elements(b.value->'employees')m WHERE b.key='owner_oct_final' AND m->>'employee_id'=test_id(12)::text),
 'Barka new metrics agree with owner without Muscat or private work');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_deals_access WHERE id=test_id(28401)),
 'Barka cannot read Muscat sale or its appended lifecycle dates');
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(crm_employee_performance('2026-10-01','2026-11-01')->'employees'->0=
 (SELECT m FROM test_coherence28 b CROSS JOIN LATERAL jsonb_array_elements(b.value->'employees')m WHERE b.key='owner_oct_final' AND m->>'employee_id'=test_id(11)::text),
 'Muscat new metrics agree with owner without Barka or private work');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_deals_access WHERE id IN(test_id(802),test_id(803),test_id(9102))),
 'appended lifecycle dates preserve private investment and opposite branch isolation');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_deals_access WHERE company_commission IS NOT NULL OR agent_share IS NOT NULL OR commission_total IS NOT NULL),
 'safe date projection does not unmask owner-only financial columns');
DO $$ BEGIN
 BEGIN PERFORM * FROM crm_repair_private.audit28_catalog_backup;RAISE EXCEPTION 'private backup exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(13)::text,false);
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-11-01')->'employees')m WHERE m->'company_commission'<>'null'::jsonb),
 'manager still receives masked completed-sale finance');
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_performance('2026-10-01','2026-11-01');RAISE EXCEPTION 'viewer performance accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(15)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_performance('2026-10-01','2026-11-01');RAISE EXCEPTION 'inactive performance accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
ROLLBACK;
SELECT 'performance coherence acceptance passed' result;
