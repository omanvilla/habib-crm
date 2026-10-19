-- Isolated synthetic catalog ONLY. Run after comprehensive-audit-assert and SQL26.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_finance26(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_finance26 TO authenticated;
INSERT INTO test_finance26 SELECT 'originalA',crm_get_deal_workflow((value->>'deal_id')::uuid) FROM test_audit_payload WHERE key='savedA';
-- Preserve an agreed historical rounded employee share on estimate-only edits.
UPDATE deals SET agent_share=200,company_share=1800.005
WHERE id=(SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA');
SET ROLE authenticated;
SELECT crm_save_deal_workflow(jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),
 'property',jsonb_build_object('id',test_id(9310)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}',
 'financials',jsonb_build_object('expected_company_commission',2100))),test_id(9601)) FROM test_audit_payload WHERE key='savedA';
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,agent_share}')::numeric=200,
 'an estimate-only edit preserves the employee commission');
-- The real owner form sends all loaded allocation fields, even when unchanged.
SELECT crm_save_deal_workflow(jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),
 'property',jsonb_build_object('id',test_id(9310)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}',
 'financials',jsonb_build_object('commission_total',2000.005,'broker_commission',0,'employee_commission_percent',10,'agent_share',200,
 'expected_company_commission',2000,'commission_received_on',NULL))),test_id(9602)) FROM test_audit_payload WHERE key='savedA';
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,agent_share}')::numeric=200,
 'resubmitting unchanged fields preserves original rounded allocations');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,company_share}')::numeric=1800.005,
 'resubmitting unchanged fields preserves the recorded company share');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,commission_received_at}')::timestamptz
 =(SELECT (value#>>'{deal,commission_received_at}')::timestamptz FROM test_finance26 WHERE key='originalA'),
 'an unrelated owner save cannot erase the last actual ledger receipt date');
SELECT test_reservation_assert((crm_commission_report('2024-10-01','2024-11-01')->>'bookings')::int=1
 AND (crm_commission_report('2024-10-01','2024-11-01')->>'expected_commission')::numeric=2000,
 'owner report honors booking date correction, without duplicating October');
SELECT test_reservation_assert((crm_commission_report('2024-09-01','2024-10-01')->>'bookings')::int=1
 AND (crm_commission_report('2024-09-01','2024-10-01')->>'expected_commission')::numeric=2500,
 'owner report shows corrected booking once in its actual month');
SELECT test_reservation_assert((crm_commission_report('2024-11-01','2024-12-01')->>'collected_commission')::numeric=4500.005
 AND (crm_commission_report('2024-10-01','2024-11-01')->>'collected_commission')::numeric=0,
 'owner report places both bookings cash receipts only in November');
INSERT INTO test_finance26 VALUES('baseline',crm_commission_report('2023-11-01','2023-12-01'));
RESET ROLE;
-- A known dated legacy gross receipt must not lose the employee share.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,entry_mode,closed_at,commission_received_at,
 commission_status,commission_total,broker_commission,company_share,agent_share)
VALUES(test_id(9600),test_id(1),test_id(100),test_id(300),test_id(11),'commission_collected','historical',
 '2023-10-31 08:00+00','2023-11-05 08:00+00','received',2000,0,1800,200),
 (test_id(9603),test_id(1),test_id(100),test_id(300),test_id(11),'commission_collected','historical',
 '2023-10-31 08:00+00',NULL,'received',1000,0,900,100);
-- Company scoped: another company's received record must not enter the report.
SELECT set_config('test.actor',test_id(16)::text,false);
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,entry_mode,closed_at,commission_received_at,
 commission_status,commission_total,broker_commission,company_share,agent_share)
VALUES(test_id(9604),test_id(2),NULL,NULL,test_id(16),'commission_collected','historical',
 '2023-10-31 08:00+00','2023-11-05 08:00+00','received',7000,0,6300,700);
SELECT set_config('test.actor',test_id(10)::text,false);
SET ROLE authenticated;
SELECT test_reservation_assert((SELECT (x->>'commission_collected')::numeric=2000
 FROM jsonb_array_elements(crm_employee_performance('2023-11-01','2023-12-01')->'employees')x
 WHERE x->>'employee_id'=test_id(11)::text),'team report uses gross company receipt before employee allocation');
SELECT test_reservation_assert((crm_commission_report('2023-11-01','2023-12-01')->>'collected_commission')::numeric=2000,
 'owner report excludes undated history and other-company receipts');
SELECT test_reservation_assert((crm_commission_report('2023-11-01','2023-12-01')->>'undated_received_deals')::int
 =(SELECT (value->>'undated_received_deals')::int+1 FROM test_finance26 WHERE key='baseline'),
 'undated received history is explicitly diagnosed rather than guessed');
SELECT test_reservation_assert((crm_commission_report('2023-11-01','2023-12-01')->>'outstanding_commission')::numeric
 =(SELECT (value->>'outstanding_commission')::numeric FROM test_finance26 WHERE key='baseline'),
 'known received deals without a date do not create fictitious outstanding commission');
-- Weekly additions and standing inventory are independent measures.
INSERT INTO test_finance26 SELECT 'weeklyBefore',x FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x WHERE x->>'id'=test_id(11)::text;
INSERT INTO properties(id,company_id,added_by,sourced_by,title,type,area,price,branch_key,status,availability_checked_at)
VALUES(test_id(9691),test_id(1),test_id(10),test_id(11),'Synthetic qualified weekly addition','villa','Synthetic Muscat',80000,'muscat','available',now());
SELECT test_reservation_assert((SELECT (x->>'inventory')::int=(b.value->>'inventory')::int+1
 AND (x->>'new_properties')::int=(b.value->>'new_properties')::int+1
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x,test_finance26 b
 WHERE x->>'id'=test_id(11)::text AND b.key='weeklyBefore'),'qualified available addition increases both independent metrics');
UPDATE properties SET status='sold' WHERE id=test_id(9691);
SELECT test_reservation_assert((SELECT (x->>'inventory')::int=(b.value->>'inventory')::int
 AND (x->>'new_properties')::int=(b.value->>'new_properties')::int+1
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x,test_finance26 b
 WHERE x->>'id'=test_id(11)::text AND b.key='weeklyBefore'),'selling a qualified new listing reduces inventory without deleting weekly credit');
DO $$ BEGIN
 BEGIN PERFORM crm_commission_report('2024-11-01','2024-11-01');RAISE EXCEPTION 'invalid period accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
-- Existing expense form precision must round-trip milli OMR.
INSERT INTO expenses(id,company_id,user_id,description,category,amount,expense_date)
VALUES(test_id(9690),test_id(1),test_id(10),'Synthetic milli OMR expense','other',1.005,'2023-11-01');
SELECT test_reservation_assert((SELECT amount=1.005 FROM expenses WHERE id=test_id(9690)),'expense milli OMR roundtrip');
SELECT set_config('test.actor',test_id(11)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_commission_report('2024-11-01','2024-12-01');RAISE EXCEPTION 'employee accessed full-company finance';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(12)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_commission_report('2024-11-01','2024-12-01');RAISE EXCEPTION 'other employee accessed full-company finance';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
DO $$ DECLARE n integer;BEGIN
 FOR n IN 13..15 LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  BEGIN PERFORM crm_commission_report('2024-11-01','2024-12-01');RAISE EXCEPTION 'unauthorized role accessed full-company finance';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
END $$;
RESET ROLE;
SELECT test_reservation_assert(NOT has_function_privilege('anon','public.crm_commission_report(date,date)','execute'),'anonymous financial report denied');
SELECT test_reservation_assert(NOT has_function_privilege('authenticated','crm_repair_private.recorded_company_commission(public.deals)','execute'),'internal amount helper cannot expose employee finance');
SELECT 'financial reporting preservation assertions passed' result;
