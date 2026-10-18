-- Isolated synthetic database ONLY; never execute on production.
CREATE FUNCTION public.test_reservation_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label;END IF;END$$;
CREATE TABLE test_reservation_original AS SELECT id,to_jsonb(d) row_data FROM deals d;
CREATE TABLE test_reservation_payload(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_reservation_payload TO authenticated;
UPDATE profiles SET full_name='Synthetic Hadeel' WHERE id=test_id(11);
UPDATE profiles SET full_name='Synthetic Maram' WHERE id=test_id(12);
-- Explicit approved branch attribution, without rewriting the original deal author.
INSERT INTO crm_repair_private.branch_performance_owners(company_id,branch_key,employee_id,effective_from)
VALUES(test_id(1),'muscat',test_id(11),'2026-08-01'),(test_id(1),'barka',test_id(12),'2026-08-01');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
-- New historical deal: paid October, closed November; no invented viewing.
INSERT INTO test_reservation_payload VALUES('create',jsonb_build_object(
 'client',jsonb_build_object('id',test_id(100)),'property',jsonb_build_object('id',test_id(300)),
 'deal',jsonb_build_object('entry_mode','historical','stage','negotiation','agent_id',test_id(11),
 'reservation',jsonb_build_object('confirm_paid',true,'paid_on','2025-10-31','amount',500,'expected_company_commission',4500))));
INSERT INTO test_reservation_payload SELECT 'created',crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='create'),test_id(9001));
SELECT test_reservation_assert((SELECT value->>'deal_id' IS NOT NULL FROM test_reservation_payload WHERE key='created'),'atomic create returns deal');
SELECT test_reservation_assert((crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='create'),test_id(9001))->>'replayed')::boolean,'create replay is idempotent');
INSERT INTO test_reservation_payload SELECT 'oct',crm_employee_performance('2025-10-01','2025-11-01');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 AND (x->>'sales')::int=0 AND (x->>'expected_commission')::numeric=4500 AND (x->>'commission_collected')::numeric=0 AND (x->>'sales_goal_met')::boolean FROM test_reservation_payload p,jsonb_array_elements(p.value->'employees') x WHERE p.key='oct' AND x->>'employee_id'=test_id(11)::text),'October earns booking and expected commission before closing');
INSERT INTO test_reservation_payload SELECT 'close',jsonb_build_object('client',jsonb_build_object('id',test_id(100)),'property',jsonb_build_object('id',test_id(300)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',(crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}'),
 'entry_mode','historical','stage','closed','closed_on','2025-11-03','financials',jsonb_build_object('commission_total',4500,'broker_commission',0,'agent_share',450))) FROM test_reservation_payload WHERE key='created';
SELECT crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='close'),test_id(9002));
-- Actual cash receipts in two different months. Replay must not duplicate either.
INSERT INTO test_reservation_payload SELECT 'receipt1',jsonb_build_object('client',jsonb_build_object('id',test_id(100)),'property',jsonb_build_object('id',test_id(300)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',(crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}'),
 'stage','closed','receipt',jsonb_build_object('received_on','2025-11-05','amount',1000,'source_note','Synthetic bank receipt 1'))) FROM test_reservation_payload WHERE key='created';
SELECT crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='receipt1'),test_id(9003));
SELECT test_reservation_assert((crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='receipt1'),test_id(9003))->>'replayed')::boolean,'receipt replay is idempotent');
INSERT INTO test_reservation_payload SELECT 'receipt2',jsonb_build_object('client',jsonb_build_object('id',test_id(100)),'property',jsonb_build_object('id',test_id(300)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',(crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}'),
 'stage','commission_collected','financials',jsonb_build_object('commission_status','received'),
 'receipt',jsonb_build_object('received_on','2025-12-05','amount',3050,'source_note','Synthetic bank receipt 2'))) FROM test_reservation_payload WHERE key='created';
SELECT crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='receipt2'),test_id(9004));
INSERT INTO test_reservation_payload SELECT 'nov',crm_employee_performance('2025-11-01','2025-12-01');
INSERT INTO test_reservation_payload SELECT 'dec',crm_employee_performance('2025-12-01','2026-01-01');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=0 AND (x->>'sales')::int=1 AND (x->>'commission_collected')::numeric=1000 AND (x->>'receipt_count')::int=1 FROM test_reservation_payload p,jsonb_array_elements(p.value->'employees') x WHERE p.key='nov' AND x->>'employee_id'=test_id(11)::text),'November contains completed sale and its actual partial receipt only');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=0 AND (x->>'sales')::int=0 AND (x->>'commission_collected')::numeric=3050 FROM test_reservation_payload p,jsonb_array_elements(p.value->'employees') x WHERE p.key='dec' AND x->>'employee_id'=test_id(11)::text),'December contains actual remaining receipt, no second booking or sale');
SELECT test_reservation_assert(crm_employee_performance('2025-10-01','2025-11-01')=(SELECT value FROM test_reservation_payload WHERE key='oct'),'advancement preserves original October performance');
-- A late booking confirmation on a closed deal must preserve the later stage.
SELECT test_reservation_assert((crm_confirm_paid_reservation((SELECT (value->>'deal_id')::uuid FROM test_reservation_payload WHERE key='created'),'2025-10-31',500,4500)->>'already_confirmed')::boolean,'same payment replays');
DO $$BEGIN
 BEGIN PERFORM crm_confirm_paid_reservation((SELECT (value->>'deal_id')::uuid FROM test_reservation_payload WHERE key='created'),'2025-11-01',500,4500);RAISE EXCEPTION 'date overwrite accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_confirm_paid_reservation(test_id(800),'2026-10-18',500,1000);RAISE EXCEPTION 'booking after closing accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END$$;
RESET ROLE;
SELECT test_reservation_assert((SELECT count(*)=2 FROM crm_repair_private.deal_commission_receipts),'two receipts after retry');
SELECT test_reservation_assert((SELECT count(*)=1 FROM crm_repair_private.deal_milestone_events WHERE event_type='reservation_confirmed_at'),'one confirmation event after retries');
SELECT test_reservation_assert((SELECT stage='commission_collected' AND company_commission_received_amount=4050 AND agent_share=450 FROM deals WHERE id=(SELECT (value->>'deal_id')::uuid FROM test_reservation_payload WHERE key='created')),'stage, actual cumulative receipts and employee commission remain separate');
-- Real Oman-local month boundary; one timestamp just before and one at November.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,entry_mode,deposit_amount,reservation_confirmed_at,reservation_evidence_note,expected_company_commission_at_reservation)
VALUES(test_id(9101),test_id(1),test_id(100),test_id(300),test_id(10),'deposit','historical',100,'2026-09-30 19:59:59+00','Synthetic confirmed payment',2000),
 (test_id(9102),test_id(1),test_id(101),test_id(301),test_id(12),'deposit','historical',100,'2026-09-30 20:00:00+00','Synthetic confirmed payment',1000);
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,entry_mode,deposit_amount)
VALUES(test_id(9103),test_id(1),test_id(100),test_id(300),test_id(11),'deposit','historical',100);
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
INSERT INTO test_reservation_payload SELECT 'sep',crm_employee_performance('2026-09-01','2026-10-01');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 FROM test_reservation_payload p,jsonb_array_elements(p.value->'employees') x WHERE p.key='sep' AND x->>'employee_id'=test_id(11)::text),'Oman month boundary and branch attribution preserve original author');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-11-01')->'employees') x WHERE x->>'employee_id'=test_id(12)::text),'midnight starts new Oman month');
-- Cancellation does not rewrite a historical KPI; it changes only live bookings.
INSERT INTO test_reservation_payload SELECT 'cancel',jsonb_build_object('client',jsonb_build_object('id',test_id(101)),'property',jsonb_build_object('id',test_id(301)),
 'deal',jsonb_build_object('id',test_id(9102),'expected_updated_at',(crm_get_deal_workflow(test_id(9102))#>>'{deal,updated_at}'),
 'stage','deposit','reservation',jsonb_build_object('cancelled_on','2026-10-03','cancellation_reason','Synthetic customer cancellation')));
SELECT crm_save_deal_workflow((SELECT value FROM test_reservation_payload WHERE key='cancel'),test_id(9005));
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 AND (x->>'active_reservations')::int=0 AND (x->>'cancelled_reservations')::int=1 AND (x->>'expected_commission')::numeric=1000 FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-11-01')->'employees') x WHERE x->>'employee_id'=test_id(12)::text),'cancellation preserves original booking and expected snapshot');
-- Both branches are scoped; owner-only investment remains absent from reports.
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_employee_performance('2026-09-01','2026-11-01')->'employees')=1,'Barka only receives its own employee row');
SELECT test_reservation_assert(NOT (crm_get_deal_workflow(test_id(9102))#>'{deal}') ? 'expected_company_commission_at_reservation','staff deal getter keeps owner finance masked');
DO $$BEGIN
 BEGIN PERFORM crm_get_deal_workflow(test_id(9101));RAISE EXCEPTION 'opposite branch getter accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_confirm_paid_reservation(test_id(802),'2019-12-31',500,NULL);RAISE EXCEPTION 'private investment accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_confirm_paid_reservation(test_id(9102),'2026-10-01',100,1000);RAISE EXCEPTION 'staff finance write accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM * FROM crm_repair_private.deal_commission_receipts;RAISE EXCEPTION 'private ledger readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(jsonb_array_length(crm_employee_target_snapshot()->'employees')=1,'target snapshot retains same-employee scope');
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$BEGIN BEGIN PERFORM crm_employee_target_snapshot();RAISE EXCEPTION 'viewer accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM test_reservation_original b JOIN deals d USING(id) WHERE to_jsonb(d) IS DISTINCT FROM b.row_data),'all pre-existing deal rows preserved');
SELECT test_reservation_assert(NOT has_function_privilege('anon','public.crm_confirm_paid_reservation(uuid,date,numeric,numeric)','execute'),'anon cannot confirm');
SELECT 'reservation period assertions passed' result;
