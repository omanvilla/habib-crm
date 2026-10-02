-- Run after deal-workflow.sql, prepared SQL13 and SQL14; synthetic values only.
CREATE TRIGGER sync_deal_request AFTER INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION sync_request_from_deal();
CREATE FUNCTION public.test_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',msg; END IF; END$$;
GRANT EXECUTE ON FUNCTION public.test_assert(boolean,text) TO authenticated;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
SET ROLE authenticated;
DO $$DECLARE p jsonb; r jsonb; r2 jsonb; d jsonb; BEGIN
 p:='{"deal":{"entry_mode":"historical","stage":"commission_collected","closed_on":"2020-03-04","financials":{"commission_total":1000,"broker_commission":200,"employee_commission_percent":12.5,"commission_status":"received","commission_received_on":null}},"client":{"name":"TEST HISTORICAL","phone":"+96890000901"},"property":{"title":"TEST HISTORICAL PROPERTY","area":"TEST AREA","type":"villa","price":75000,"branch_key":"muscat"},"owner":{"name":"TEST OWNER","phone":"+96890000902"}}'::jsonb;
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001001');
 PERFORM test_assert((r->>'ok')::boolean,'explicit success acknowledgement');
 PERFORM test_assert(r->>'viewing_id' IS NULL,'historical unknown visit stays absent');
 r2:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001001');
 PERFORM test_assert(r2->>'deal_id'=r->>'deal_id' AND (r2->>'replayed')::boolean,'idempotent historical replay');
 BEGIN PERFORM crm_save_deal_workflow(jsonb_set(p,'{deal,closed_on}','"2022-01-01"'),'00000000-0000-4000-8000-000000001001'); RAISE EXCEPTION 'expected hash mismatch'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='idempotency_key_reused_with_different_payload','idempotency hash failure'); END;
 d:=crm_get_deal_workflow((r->>'deal_id')::uuid)->'deal';
 PERFORM test_assert((d->>'closed_at')::timestamptz='2020-03-04T08:00:00Z','actual historical sale date');
 PERFORM test_assert(d->>'commission_received_at' IS NULL,'unknown historical receipt date not invented');
 PERFORM test_assert((d->>'agent_share')::numeric=100 AND (d->>'company_share')::numeric=700,'percent uses gross company commission less broker');
 PERFORM test_assert((d->>'created_at')::timestamptz>'2020-03-04','entry audit date not backdated');
 PERFORM set_config('test.historical_id',r->>'deal_id',false);
 PERFORM set_config('test.historical_client',r->>'client_id',false);
 PERFORM set_config('test.historical_property',r->>'property_id',false);
END$$;
RESET ROLE;
SELECT test_assert((SELECT count(*)=0 FROM viewings),'historical no synthetic visit');
SELECT test_assert((SELECT count(*)=0 FROM client_requests),'historical no synthetic request');
SELECT test_assert((SELECT count(*)=1 FROM owners),'owner inserted atomically once');
SELECT test_assert((SELECT count(*)=1 FROM properties WHERE title='TEST HISTORICAL PROPERTY'),'property idempotency');
SET ROLE authenticated;
DO $$DECLARE p jsonb; before_count int; BEGIN
 p:='{"deal":{"entry_mode":"current","stage":"closed","closed_on":"2022-06-07"},"client":{"name":"TEST ROLLBACK","phone":"+96890000903"},"property":{"title":"TEST ROLLBACK PROPERTY","area":"TEST AREA","type":"villa","price":75000,"branch_key":"muscat"},"owner":{"name":"TEST ROLLBACK OWNER","phone":"+96890000904"}}'::jsonb;
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001002'); RAISE EXCEPTION 'expected visit required'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='completed_visit_required_for_current_deal','current completion needs visit'); END;
END$$;
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE name='TEST ROLLBACK'),'rollback newly created client');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM properties WHERE title='TEST ROLLBACK PROPERTY'),'rollback newly created property');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM owners WHERE name='TEST ROLLBACK OWNER'),'rollback newly created owner');
SET ROLE authenticated;
DO $$DECLARE p jsonb;r jsonb;d jsonb; BEGIN
 p:='{"deal":{"entry_mode":"current","stage":"commission_collected","agent_id":"00000000-0000-4000-8000-000000000002","closed_on":"2022-06-07","visit_date":"2022-06-01","financials":{"commission_total":1000,"broker_commission":0,"agent_share":175,"commission_status":"received","commission_received_on":"2022-06-09"}},"client":{"id":"00000000-0000-4000-8000-000000000201"},"property":{"id":"00000000-0000-4000-8000-000000000103"}}';
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001003');
 PERFORM set_config('test.current_id',r->>'deal_id',false);
 PERFORM set_config('test.current_viewing',r->>'viewing_id',false);
 PERFORM test_assert(r->>'viewing_id' IS NOT NULL,'real supplied visit saved');
 d:=crm_get_deal_workflow((r->>'deal_id')::uuid)->'deal';
 PERFORM test_assert((d->>'agent_share')::numeric=175 AND d->>'employee_commission_percent' IS NULL,'explicit fixed legacy-compatible amount');
 p:=jsonb_build_object('deal',jsonb_build_object('id',r->>'deal_id','expected_updated_at',d->>'updated_at','entry_mode','legacy','stage','commission_collected','closed_on',NULL),'client',p->'client','property',p->'property');
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001004'); RAISE EXCEPTION 'expected legacy downgrade denied'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='cannot_downgrade_deal_to_legacy','downgrade guard'); END;
 BEGIN UPDATE deals SET entry_mode='legacy' WHERE id=(r->>'deal_id')::uuid; RAISE EXCEPTION 'expected direct downgrade denied'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='cannot_downgrade_deal_to_legacy','direct downgrade guard'); END;
END$$;
RESET ROLE;
SELECT test_assert((SELECT count(*)=1 FROM viewings WHERE id=current_setting('test.current_viewing')::uuid AND viewing_date='2022-06-01' AND viewing_time IS NULL AND appointment_id IS NULL),'date-only completed visit preserves unknown time');
SELECT test_assert((SELECT count(*)=1 FROM deals WHERE viewing_id=current_setting('test.current_viewing')::uuid),'generated visit card reused exactly once');
SELECT test_assert((SELECT count(*)=1 FROM property_inquiries WHERE property_id='00000000-0000-4000-8000-000000000103' AND has_inbound_inquiry IS FALSE),'visit is not inbound inquiry');
SELECT test_assert((SELECT negotiation_started_at IS NULL AND opportunity_opened_at IS NULL AND closed_won_at='2022-06-07T08:00:00Z' FROM client_requests WHERE subject_property_id='00000000-0000-4000-8000-000000000103'),'no fake interim milestones');
SET ROLE authenticated;
DO $$DECLARE p jsonb;d jsonb;r jsonb;BEGIN
 d:=crm_get_deal_workflow('00000000-0000-4000-8000-000000000902')->'deal';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode','legacy','stage','commission_collected','closed_on',NULL,'notes','Edited actual note'),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001005');
 d:=crm_get_deal_workflow((d->>'id')::uuid)->'deal';
 PERFORM test_assert((d->>'agent_share')::numeric=183 AND (d->>'company_share')::numeric=617,'routine old edit preserves amounts');
 PERFORM test_assert(d->>'closed_at' IS NULL AND d->>'commission_received_at' IS NULL,'routine old edit preserves unknown dates');
 PERFORM test_assert((d->>'created_at')::timestamptz='2020-02-03T04:05:06Z','authored date preserved');
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001006'); RAISE EXCEPTION 'expected stale'; EXCEPTION WHEN SQLSTATE '40001' THEN PERFORM test_assert(SQLERRM='deal_changed_reload_before_saving','stale conflict'); END;
END$$;
-- Grandfather unchanged legacy dates, but never accept newly entered invalid dates.
DO $$DECLARE d jsonb;p jsonb; BEGIN
 d:=crm_get_deal_workflow('00000000-0000-4000-8000-000000000902')->'deal';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode','legacy','stage','commission_collected','closed_on','2099-01-01'),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001011'); RAISE EXCEPTION 'expected future sale denied'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='sale_date_cannot_be_future','explicit legacy future date rejected'); END;
 p:=jsonb_set(p,'{deal,closed_on}','"2022-02-03"');
 p:=jsonb_set(p,'{deal,financials}','{"commission_received_on":"2020-01-01"}'::jsonb);
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001012'); RAISE EXCEPTION 'expected receipt ordering'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='commission_date_must_follow_sale','explicit legacy receipt validates order'); END;
 d:=crm_get_deal_workflow(current_setting('test.current_id')::uuid)->'deal';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode','current','stage','commission_collected','financials',jsonb_build_object('commission_received_on',NULL)),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001013'); RAISE EXCEPTION 'expected current receipt required'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='commission_received_date_required','current receipt required'); END;
END$$;
-- Actual authenticated staff grants, not a postgres query with JWT alone.
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
DO $$DECLARE d jsonb;p jsonb;r jsonb;BEGIN
 d:=crm_get_deal_workflow(current_setting('test.current_id')::uuid)->'deal';
 PERFORM test_assert(NOT d ? 'commission_total' AND NOT d ? 'employee_commission_percent' AND NOT d ? 'commission_received_at','staff get redacts financial metadata');
 BEGIN PERFORM commission_total FROM deals LIMIT 1; RAISE EXCEPTION 'expected column restriction'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM test_assert((SELECT commission_total IS NULL AND employee_commission_percent IS NULL AND commission_received_at IS NULL FROM crm_deals_access WHERE id=current_setting('test.current_id')::uuid),'masked view covers added financial columns');
 BEGIN PERFORM crm_get_deal_workflow('00000000-0000-4000-8000-000000000902'); RAISE EXCEPTION 'expected foreign branch denial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 d:=crm_get_deal_workflow('00000000-0000-4000-8000-000000000901')->'deal';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode','legacy','stage','lost','notes',d->>'notes','lost_reason_note',NULL),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001007');
 d:=crm_get_deal_workflow((r->>'deal_id')::uuid)->'deal';
 PERFORM test_assert(d->>'lost_reason_id' IS NULL AND d->>'lost_reason_note' IS NULL,'legacy missing loss reason not invented');
 PERFORM test_assert(d->>'notes'='تم إنشاؤها تلقائياً من زيارة بتاريخ 2026-06-29','provenance preserved');
 p:=jsonb_set(p,'{deal,expected_updated_at}',to_jsonb(d->>'updated_at'));
 p:=jsonb_set(p,'{deal,financials}','{"commission_total":999}'::jsonb);
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001008'); RAISE EXCEPTION 'expected finance denial'; EXCEPTION WHEN insufficient_privilege THEN PERFORM test_assert(SQLERRM='owner_only_financial_fields','staff finance denied'); END;
 p:='{"deal":{"entry_mode":"historical","stage":"closed","closed_on":"2020-03-04"},"client":{"id":"00000000-0000-4000-8000-000000000201"},"property":{"id":"00000000-0000-4000-8000-000000000102"}}';
 BEGIN PERFORM crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001009'); RAISE EXCEPTION 'expected property denied'; EXCEPTION WHEN insufficient_privilege THEN PERFORM test_assert(SQLERRM='property_not_allowed','foreign property denied'); END;
 BEGIN UPDATE deals SET commission_received_at=now() WHERE id=current_setting('test.current_id')::uuid; RAISE EXCEPTION 'expected direct financial denial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
-- A scheduled journey remains editable without converting its link into a completed visit.
SELECT set_config('test.actor','',false);
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,viewing_time,status,created_by) VALUES('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','2026-01-01','10:00','scheduled','00000000-0000-4000-8000-000000000002');
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
DO $$DECLARE d jsonb;p jsonb;r jsonb; BEGIN
 SELECT crm_get_deal_workflow(id)->'deal' INTO d FROM deals WHERE viewing_id='00000000-0000-4000-8000-000000000801';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode',d->>'entry_mode','stage',d->>'stage','viewing_id',d->>'viewing_id','notes','TEST scheduled follow up'),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001010');
 PERFORM test_assert(r->>'deal_id'=d->>'id','scheduled visit-linked card remains editable');
 BEGIN UPDATE deals SET stage='closed',closed_at='2022-06-07T08:00:00Z' WHERE id=(d->>'id')::uuid; RAISE EXCEPTION 'expected direct completion denied'; EXCEPTION WHEN SQLSTATE '22023' THEN PERFORM test_assert(SQLERRM='completed_visit_required_for_current_deal','drag or old direct completion needs actual visit'); END;
END$$;
RESET ROLE;
-- Convert the same legacy scheduled card with NULL request into a completed sale.
-- With SQL15 exact-request matching, the private context prevents an extra auto-created card.
SET ROLE authenticated;
DO $$DECLARE d jsonb;p jsonb;r jsonb;before_count int; BEGIN
 SELECT crm_get_deal_workflow(id)->'deal' INTO d FROM deals WHERE viewing_id='00000000-0000-4000-8000-000000000801';
 SELECT count(*) INTO before_count FROM deals WHERE client_id='00000000-0000-4000-8000-000000000201' AND property_id='00000000-0000-4000-8000-000000000101';
 p:=jsonb_build_object('deal',jsonb_build_object('id',d->>'id','expected_updated_at',d->>'updated_at','entry_mode','current','stage','closed','viewing_id',NULL,'visit_date','2022-05-01','closed_on','2022-05-03'),'client',jsonb_build_object('id',d->>'client_id'),'property',jsonb_build_object('id',d->>'property_id'));
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001014');
 PERFORM test_assert(r->>'deal_id'=d->>'id','scheduled conversion preserves card identity');
 PERFORM test_assert((SELECT count(*)=before_count FROM deals WHERE client_id='00000000-0000-4000-8000-000000000201' AND property_id='00000000-0000-4000-8000-000000000101'),'scheduled conversion creates no extra pipeline card');
 PERFORM test_assert((crm_get_deal_workflow((r->>'deal_id')::uuid)#>>'{deal,created_at}')::timestamptz=(d->>'created_at')::timestamptz,'conversion preserves audit creation date');
END$$;
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_workflow_context),'private transaction context cleared');
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
INSERT INTO properties(id,company_id,title,type,area,price,branch_key) VALUES('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000001','TEST EXISTING VISIT','villa','TEST',90000,'muscat');
SET ROLE authenticated;
DO $$DECLARE v jsonb;d jsonb;r jsonb;p jsonb; BEGIN
 v:=crm_save_viewing_atomic('{"client_id":"00000000-0000-4000-8000-000000000201","property_id":"00000000-0000-4000-8000-000000000104","agent_id":"00000000-0000-4000-8000-000000000002","viewing_date":"2022-07-01","status":"done","time_unknown":true}','00000000-0000-4000-8000-000000001015');
 SELECT crm_get_deal_workflow(id)->'deal' INTO d FROM deals WHERE viewing_id=(v->>'viewing_id')::uuid;
 UPDATE deals SET agent_share=123,commission_total=1000,company_share=877,notes='Original authored notes' WHERE id=(d->>'id')::uuid;
 p:=jsonb_build_object('deal',jsonb_build_object('entry_mode','current','stage','closed','viewing_id',v->>'viewing_id','closed_on','2022-07-03','financials',jsonb_build_object('commission_total',NULL,'agent_share',NULL,'employee_commission_percent',NULL,'commission_status','pending')),'client',jsonb_build_object('id','00000000-0000-4000-8000-000000000201'),'property',jsonb_build_object('id','00000000-0000-4000-8000-000000000104'));
 r:=crm_save_deal_workflow(p,'00000000-0000-4000-8000-000000001016');
 PERFORM test_assert(r->>'deal_id'=d->>'id','new entry selecting existing visit reuses card');
 PERFORM test_assert((SELECT count(*)=1 FROM deals WHERE viewing_id=(v->>'viewing_id')::uuid),'existing visit card not duplicated');
 d:=crm_get_deal_workflow((r->>'deal_id')::uuid)->'deal';
 PERFORM test_assert((d->>'agent_share')::numeric=123 AND d->>'notes'='Original authored notes' AND d->>'agent_id'='00000000-0000-4000-8000-000000000002','reuse preserves finance, notes and employee');
END$$;
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
SET ROLE authenticated;
DO $$DECLARE d jsonb; BEGIN
 d:=crm_get_deal_workflow('00000000-0000-4000-8000-000000000902')->'deal';
 PERFORM test_assert(d->>'id'='00000000-0000-4000-8000-000000000902' AND NOT d ? 'agent_share','Barka staff sees own record with finance redacted');
 BEGIN PERFORM crm_get_deal_workflow(current_setting('test.current_id')::uuid); RAISE EXCEPTION 'expected reverse branch denial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
SELECT 'deal workflow assertions passed' AS result;
