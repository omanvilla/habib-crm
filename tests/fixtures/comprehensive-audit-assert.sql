-- Synthetic full catalog ONLY. Run after SQL24 assertions and SQL25.
CREATE TABLE test_audit_payload(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_audit_payload TO authenticated;
INSERT INTO public.clients(id,company_id,assigned_to,name,phone,lead_route)
VALUES(test_id(9300),test_id(1),test_id(11),'Synthetic booking A','+96800009300','muscat'),
 (test_id(9301),test_id(1),test_id(11),'Synthetic booking B','+96800009301','muscat');
INSERT INTO public.properties(id,company_id,added_by,sourced_by,title,type,area,price,branch_key,status,availability_checked_at)
VALUES(test_id(9310),test_id(1),test_id(10),test_id(11),'Synthetic property A','villa','Synthetic Muscat',80000,'muscat','available',now()),
 (test_id(9311),test_id(1),test_id(10),test_id(11),'Synthetic property B','villa','Synthetic Muscat',80000,'muscat','available',now());
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
-- The explicit deposit stage confirms payment without a separate flag or file.
INSERT INTO test_audit_payload VALUES('A',jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),'property',jsonb_build_object('id',test_id(9310)),
 'deal',jsonb_build_object('stage','deposit','entry_mode','historical','agent_id',test_id(11),'reservation',jsonb_build_object('paid_on','2024-10-15','amount',500.005,'expected_company_commission',2000))));
INSERT INTO test_audit_payload VALUES('B',jsonb_build_object('client',jsonb_build_object('id',test_id(9301)),'property',jsonb_build_object('id',test_id(9311)),
 'deal',jsonb_build_object('stage','deposit','entry_mode','historical','agent_id',test_id(11),'reservation',jsonb_build_object('paid_on','2024-10-31','amount',500,'expected_company_commission',2500,'reference','optional synthetic bank reference'))));
INSERT INTO test_audit_payload SELECT 'savedA',crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='A'),test_id(9400));
INSERT INTO test_audit_payload SELECT 'savedB',crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='B'),test_id(9401));
SELECT test_reservation_assert((crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='A'),test_id(9400))->>'replayed')::boolean,'deposit stage retry returns the same booking');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,deposit_amount}')::numeric=500.005,'paid deposit retains OMR milli precision');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedB'))#>>'{deal,reservation_reference}')='optional synthetic bank reference','optional reference is returned');
-- This year has no earlier synthetic bookings: exactly two and4500.
INSERT INTO test_audit_payload SELECT 'oct',crm_employee_performance('2024-10-01','2024-11-01');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=2 AND (x->>'expected_commission')::numeric=4500 FROM test_audit_payload p,jsonb_array_elements(p.value->'employees')x WHERE p.key='oct' AND x->>'employee_id'=test_id(11)::text),'acceptance: two October bookings add exactly4500');
-- Close A in November and record a partial actual receipt then the remainder.
INSERT INTO test_audit_payload SELECT 'closeA',jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),'property',jsonb_build_object('id',test_id(9310)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}','stage','closed','closed_on','2024-11-03',
 'financials',jsonb_build_object('commission_total',2000.005,'broker_commission',0,'employee_commission_percent',10),
 'receipt',jsonb_build_object('received_on','2024-11-04','amount',500.005,'source_note','synthetic partial receipt'))) FROM test_audit_payload WHERE key='savedA';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='closeA'),test_id(9402));
SELECT test_reservation_assert((crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='closeA'),test_id(9402))->>'replayed')::boolean,'closing and partial receipt replay once');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,agent_share}')::numeric=200.001,'employee percentage rounds once to milli OMR');
SELECT test_reservation_assert((crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'))#>>'{deal,company_commission_remaining}')::numeric=1500,'remaining uses actual receipts, separate from employee share');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=2 AND (x->>'expected_commission')::numeric=4500 AND (x->>'commission_collected')::numeric=0 FROM jsonb_array_elements(crm_employee_performance('2024-10-01','2024-11-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'November closing and partial receipt do not move October bookings');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=0 AND (x->>'commission_collected')::numeric=500.005 FROM jsonb_array_elements(crm_employee_performance('2024-11-01','2024-12-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'November contains only the actual partial receipt500.005');
-- Complete A's receipt and close/collect B, all in November.
INSERT INTO test_audit_payload SELECT 'finishA',jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),'property',jsonb_build_object('id',test_id(9310)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}','stage','closed',
 'receipt',jsonb_build_object('received_on','2024-11-15','amount',1500,'source_note','synthetic remaining receipt'))) FROM test_audit_payload WHERE key='savedA';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='finishA'),test_id(9406));
INSERT INTO test_audit_payload SELECT 'closeB',jsonb_build_object('client',jsonb_build_object('id',test_id(9301)),'property',jsonb_build_object('id',test_id(9311)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}','stage','closed','closed_on','2024-11-03',
 'financials',jsonb_build_object('commission_total',2500,'broker_commission',0,'employee_commission_percent',10),
 'receipt',jsonb_build_object('received_on','2024-11-04','amount',2500,'source_note','synthetic full B receipt'))) FROM test_audit_payload WHERE key='savedB';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='closeB'),test_id(9407));
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=0 AND (x->>'sales')::int=2 AND (x->>'receipt_count')::int=3 AND (x->>'commission_collected')::numeric=4500.005 FROM jsonb_array_elements(crm_employee_performance('2024-11-01','2024-12-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'both receipts stay in November; two sales and no bookings');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=2 AND (x->>'expected_commission')::numeric=4500 AND (x->>'commission_collected')::numeric=0 FROM jsonb_array_elements(crm_employee_performance('2024-10-01','2024-11-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'all collection preserves exactly two October bookings and4500 expected');
-- Cancel B without erasing the historical booking; then reactivate SAME booking.
INSERT INTO test_audit_payload SELECT 'cancelB',jsonb_build_object('client',jsonb_build_object('id',test_id(9301)),'property',jsonb_build_object('id',test_id(9311)),
 'deal',jsonb_build_object('id',value->>'deal_id','expected_updated_at',crm_get_deal_workflow((value->>'deal_id')::uuid)#>>'{deal,updated_at}','stage','deposit',
 'reservation',jsonb_build_object('cancelled_on','2024-11-05','cancellation_reason','synthetic cancellation'))) FROM test_audit_payload WHERE key='savedB';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='cancelB'),test_id(9403));
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=2 AND (x->>'active_reservations')::int=1 AND (x->>'expected_commission')::numeric=4500 FROM jsonb_array_elements(crm_employee_performance('2024-10-01','2024-11-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'cancelled booking retains month and expected snapshot');
INSERT INTO test_audit_payload SELECT 'reactivateB',jsonb_set(value,'{deal}',(value->'deal')||jsonb_build_object('expected_updated_at',crm_get_deal_workflow((value#>>'{deal,id}')::uuid)#>>'{deal,updated_at}','reservation',jsonb_build_object('reactivate',true,'correction_reason','synthetic customer resumed'))) FROM test_audit_payload WHERE key='cancelB';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='reactivateB'),test_id(9404));
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=2 AND (x->>'active_reservations')::int=2 FROM jsonb_array_elements(crm_employee_performance('2024-10-01','2024-11-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'reactivation changes active count, never duplicates the booking');
-- Correct an erroneous business date, retaining original audit and recording reason.
INSERT INTO test_audit_payload SELECT 'correctB',jsonb_set(value,'{deal}',(value->'deal')||jsonb_build_object('expected_updated_at',crm_get_deal_workflow((value#>>'{deal,id}')::uuid)#>>'{deal,updated_at}','reservation',jsonb_build_object('correct_paid_on','2024-09-30','correction_reason','synthetic verified date correction'))) FROM test_audit_payload WHERE key='reactivateB';
SELECT crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='correctB'),test_id(9405));
SELECT test_reservation_assert((crm_save_deal_workflow((SELECT value FROM test_audit_payload WHERE key='correctB'),test_id(9405))->>'replayed')::boolean,'date correction retry is idempotent');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 AND (x->>'expected_commission')::numeric=2000 FROM jsonb_array_elements(crm_employee_performance('2024-10-01','2024-11-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'date correction removes one booking from wrong month');
SELECT test_reservation_assert((SELECT (x->>'reservations')::int=1 AND (x->>'expected_commission')::numeric=2500 FROM jsonb_array_elements(crm_employee_performance('2024-09-01','2024-10-01')->'employees')x WHERE x->>'employee_id'=test_id(11)::text),'date correction adds same booking once in true month');
-- Reject an unconfirmed transition atomically and a missing correction reason.
DO $$ BEGIN
 BEGIN PERFORM crm_save_deal_workflow(jsonb_build_object('client',jsonb_build_object('id',test_id(9300)),'property',jsonb_build_object('id',test_id(9310)),'deal',jsonb_build_object('stage','deposit','entry_mode','historical','agent_id',test_id(11))),test_id(9490));RAISE EXCEPTION 'missing payment accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_save_deal_workflow(jsonb_set((SELECT value FROM test_audit_payload WHERE key='correctB'),'{deal}',((SELECT value->'deal' FROM test_audit_payload WHERE key='correctB')||jsonb_build_object('expected_updated_at',crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedB'))#>>'{deal,updated_at}','reservation',jsonb_build_object('correct_paid_on','2024-10-01')))),test_id(9491));RAISE EXCEPTION 'reasonless correction accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
-- Manual contact logging is atomic, acknowledged, idempotent and outcome-based.
INSERT INTO test_audit_payload VALUES('activity',jsonb_build_object('client_id',test_id(9300),'type','call','description','synthetic followup','outcome','no reply','next_action','try later'));
SELECT crm_log_human_activity((SELECT value FROM test_audit_payload WHERE key='activity'),test_id(9450));
SELECT test_reservation_assert((crm_log_human_activity((SELECT value FROM test_audit_payload WHERE key='activity'),test_id(9450))->>'replayed')::boolean,'human followup retry does not duplicate');
DO $$ BEGIN
 BEGIN PERFORM crm_log_human_activity(jsonb_build_object('client_id',test_id(9300),'type','call','description','synthetic missing outcome'),test_id(9451));RAISE EXCEPTION 'undocumented contact accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
-- Owner-only goal edits round trip through the same scoped snapshot.
INSERT INTO employee_monthly_targets(company_id,employee_id,month_start,inventory_target,weekly_new_properties_target,daily_followups_target,weekly_viewings_target,reservations_target,booking_commission_target)
VALUES(test_id(1),test_id(11),date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date,10,2,12,5,2,4000)
ON CONFLICT(company_id,employee_id,month_start) DO UPDATE SET daily_followups_target=12;
SELECT test_reservation_assert((SELECT (x#>>'{goals,followups}')::int=12 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x WHERE x->>'id'=test_id(11)::text),'saved owner target is used by snapshot');
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT crm_log_human_activity((SELECT value FROM test_audit_payload WHERE key='activity'),test_id(9452));
SELECT crm_log_human_activity((SELECT value FROM test_audit_payload WHERE key='activity'),test_id(9453));
SELECT test_reservation_assert((SELECT (x->>'followups')::int=1 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')x WHERE x->>'id'=test_id(11)::text),'same client cannot inflate daily target with duplicate activities');
DO $$ BEGIN
 BEGIN PERFORM crm_save_deal_workflow(jsonb_set((SELECT value FROM test_audit_payload WHERE key='correctB'),'{deal}',((SELECT value->'deal' FROM test_audit_payload WHERE key='correctB')||jsonb_build_object('expected_updated_at',crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedB'))#>>'{deal,updated_at}','reservation',jsonb_build_object('correct_paid_on','2024-10-01','correction_reason','forged employee correction')))),test_id(9492));RAISE EXCEPTION 'employee date correction accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE employee_monthly_targets SET daily_followups_target=999 WHERE employee_id=test_id(11);IF FOUND THEN RAISE EXCEPTION 'employee target edit accepted';END IF;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE profiles SET role='owner' WHERE id=test_id(11);RAISE EXCEPTION 'employee elevated own role';EXCEPTION WHEN insufficient_privilege THEN NULL;WHEN raise_exception THEN IF SQLERRM<>'غير مسموح لك بتغيير صلاحية حسابك' THEN RAISE;END IF;END;
 BEGIN PERFORM crm_log_human_activity(jsonb_build_object('client_id',test_id(102),'type','call','description','private read','outcome','x'),test_id(9493));RAISE EXCEPTION 'private activity accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(12)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_get_deal_workflow((SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA'));RAISE EXCEPTION 'opposite-branch deal accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_log_human_activity((SELECT value FROM test_audit_payload WHERE key='activity'),test_id(9494));RAISE EXCEPTION 'opposite-branch activity accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.reservation_change_context),'correction capability is not left behind');
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM crm_repair_private.deal_milestone_events WHERE event_type='reservation_confirmed_at' AND after_data->>'reason'='synthetic verified date correction'),'date correction records original, corrected value, actor, reason and time');
SELECT test_reservation_assert(NOT has_function_privilege('anon','public.crm_log_human_activity(jsonb,uuid)','execute'),'anonymous activity logging denied');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.audit25_business_before b JOIN deals d ON b.table_name='deals' AND d.id=b.id WHERE to_jsonb(d)-'reservation_reference' IS DISTINCT FROM b.row_data),'all pre-existing deals retain exact business values');
SELECT 'comprehensive audit assertions passed' result;
