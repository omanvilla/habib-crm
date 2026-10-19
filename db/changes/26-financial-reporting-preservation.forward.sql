-- SQL26: preserve financial allocations and report actual dated company receipts.
-- No guessed business dates, receipt backfill, bulk recalculation or row cleanup.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit26_catalog_backup(identity text PRIMARY KEY,definition text NOT NULL,applied_definition text);
ALTER TABLE crm_repair_private.audit26_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit26_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.audit26_catalog_backup(identity,definition)
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid IN ('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure,
 'crm_repair_private.get_deal_workflow(uuid)'::regprocedure,
 'crm_repair_private.deal_period_metrics(date,date)'::regprocedure,
 'public.crm_employee_target_snapshot()'::regprocedure)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS crm_repair_private.audit26_expenses_before AS SELECT id,to_jsonb(e) row_data FROM public.expenses e;
ALTER TABLE crm_repair_private.audit26_expenses_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit26_expenses_before FROM PUBLIC,anon,authenticated,service_role;
-- Keep the existing integer range. Rollback never truncates a milli-OMR value.
ALTER TABLE public.expenses ALTER COLUMN amount TYPE numeric(13,3);

CREATE OR REPLACE FUNCTION crm_repair_private.recorded_company_commission(d public.deals)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((d).commission_total-coalesce((d).broker_commission,0),
  (d).company_commission,
  CASE WHEN (d).company_share IS NOT NULL THEN (d).company_share+coalesce((d).agent_share,0) END)
$$;
REVOKE ALL ON FUNCTION crm_repair_private.recorded_company_commission(public.deals) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.save_deal_workflow(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 u uuid:=auth.uid(); c uuid:=public.my_company(); role_name text:=public.my_role(); dp jsonb:=p_payload->'deal'; f jsonb;
 old_d public.deals%rowtype; d public.deals%rowtype; op crm_repair_private.deal_save_operations%rowtype;
 pid uuid; cid uuid; oid uuid; vid uuid; rid uuid; aid uuid; branch text; prop_owner uuid; ph text; phone_value text;
 request_kind text; req_count integer; visit_result jsonb; generated_id uuid; actual_visit date; sale_day date; result jsonb; is_new boolean; commission_terms_changed boolean;
BEGIN
 IF u IS NULL OR c IS NULL OR coalesce(role_name,'') NOT IN('owner','manager','agent') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND company_id=c AND is_active IS TRUE) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(dp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'deal_payload_and_operation_key_required' USING ERRCODE='22023'; END IF;
 ph:=md5(p_payload::text);
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':deal:'||p_idempotency_key::text,0));
 SELECT * INTO op FROM crm_repair_private.deal_save_operations WHERE user_id=u AND operation_key=p_idempotency_key;
 IF FOUND THEN
  IF op.payload_hash<>ph THEN RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE='22023'; END IF;
  IF NOT crm_repair_private.can_access_deal_workflow(op.deal_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
  RETURN op.result||jsonb_build_object('replayed',true);
 END IF;
 d.id:=nullif(dp->>'id','')::uuid; is_new:=d.id IS NULL;
 IF NOT is_new THEN
  IF NOT crm_repair_private.can_access_deal_workflow(d.id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO old_d FROM public.deals WHERE id=d.id AND company_id=c FOR UPDATE;
  IF nullif(dp->>'expected_updated_at','')::timestamptz IS DISTINCT FROM old_d.updated_at THEN RAISE EXCEPTION 'deal_changed_reload_before_saving' USING ERRCODE='40001'; END IF;
  d:=old_d;
 END IF;
 d.id:=coalesce(d.id,gen_random_uuid()); d.company_id:=c;
 d.entry_mode:=coalesce(nullif(dp->>'entry_mode',''),d.entry_mode,'current');
 IF NOT is_new AND d.entry_mode='legacy' AND old_d.entry_mode<>'legacy' THEN RAISE EXCEPTION 'cannot_downgrade_deal_to_legacy' USING ERRCODE='22023'; END IF;
 IF d.entry_mode NOT IN('current','historical','legacy') OR (is_new AND d.entry_mode='legacy') THEN RAISE EXCEPTION 'invalid_deal_entry_mode' USING ERRCODE='22023'; END IF;
 d.stage:=coalesce(nullif(dp->>'stage',''),d.stage,'new');
 IF d.stage NOT IN('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected','lost') THEN RAISE EXCEPTION 'invalid_deal_stage' USING ERRCODE='22023'; END IF;
 f:=dp->'financials';
 IF f IS NOT NULL AND f<>'null'::jsonb AND role_name<>'owner' THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 IF role_name<>'owner' AND d.stage='commission_collected' AND (is_new OR old_d.stage IS DISTINCT FROM d.stage) THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 pid:=nullif(p_payload#>>'{property,id}','')::uuid;
 IF pid IS NOT NULL THEN
  SELECT branch_key,owner_id INTO branch,prop_owner FROM public.properties WHERE id=pid AND company_id=c FOR UPDATE;
  IF NOT FOUND OR NOT crm_repair_private.staff_can_access_branch(c,branch) THEN RAISE EXCEPTION 'property_not_allowed' USING ERRCODE='42501'; END IF;
 ELSE
  branch:=nullif(p_payload#>>'{property,branch_key}','');
  IF NOT crm_repair_private.staff_can_access_branch(c,branch) THEN RAISE EXCEPTION 'property_branch_not_allowed' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(p_payload#>>'{property,title}'),'') IS NULL OR nullif(btrim(p_payload#>>'{property,area}'),'') IS NULL OR nullif(p_payload#>>'{property,price}','') IS NULL THEN RAISE EXCEPTION 'property_title_area_price_required' USING ERRCODE='22023'; END IF;
 END IF;
 cid:=nullif(p_payload#>>'{client,id}','')::uuid;
 IF NOT is_new AND (cid IS DISTINCT FROM old_d.client_id OR pid IS DISTINCT FROM old_d.property_id) THEN RAISE EXCEPTION 'deal_identity_change_requires_new_record' USING ERRCODE='22023'; END IF;
 aid:=coalesce(nullif(dp->>'agent_id','')::uuid,d.agent_id,u);
 IF role_name='agent' AND aid<>u THEN RAISE EXCEPTION 'deal_agent_not_allowed' USING ERRCODE='42501'; END IF;
 IF (is_new OR aid IS DISTINCT FROM old_d.agent_id) AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=aid AND p.company_id=c AND p.is_active IS TRUE AND (p.role IN('owner','manager') OR (p.role='agent' AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=c AND lr.assigned_to=aid AND lr.route_key=branch AND lr.owner_only_inbox IS FALSE)))) THEN RAISE EXCEPTION 'deal_agent_not_allowed' USING ERRCODE='42501'; END IF;
 IF cid IS NOT NULL THEN
  IF NOT crm_repair_private.can_access_client(c,cid) THEN RAISE EXCEPTION 'client_not_allowed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.clients WHERE id=cid AND company_id=c FOR UPDATE;
 ELSE
  IF nullif(btrim(p_payload#>>'{client,name}'),'') IS NULL OR nullif(btrim(p_payload#>>'{client,phone}'),'') IS NULL THEN RAISE EXCEPTION 'client_name_phone_required' USING ERRCODE='22023'; END IF;
  phone_value:=regexp_replace(p_payload#>>'{client,phone}','[^0-9]','','g');
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':clientphone:'||phone_value,0));
  IF EXISTS(SELECT 1 FROM public.clients WHERE company_id=c AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=phone_value) THEN RAISE EXCEPTION 'client_phone_exists_select_existing' USING ERRCODE='22023'; END IF;
  INSERT INTO public.clients(company_id,assigned_to,name,phone,client_type,is_buyer,lead_route,source)
  VALUES(c,aid,btrim(p_payload#>>'{client,name}'),btrim(p_payload#>>'{client,phone}'),'buyer',true,branch,'manual') RETURNING id INTO cid;
 END IF;
 oid:=nullif(p_payload#>>'{owner,id}','')::uuid;
 IF oid IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.owners o WHERE o.id=oid AND o.company_id=c AND (role_name IN('owner','manager') OR o.added_by=u OR EXISTS(SELECT 1 FROM public.properties p WHERE p.company_id=c AND p.owner_id=o.id AND crm_repair_private.staff_can_access_branch(c,p.branch_key)))) THEN RAISE EXCEPTION 'owner_not_allowed' USING ERRCODE='42501'; END IF;
 ELSIF nullif(btrim(p_payload#>>'{owner,name}'),'') IS NOT NULL THEN
  IF nullif(btrim(p_payload#>>'{owner,phone}'),'') IS NULL THEN RAISE EXCEPTION 'owner_phone_required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.owners(company_id,added_by,name,phone) VALUES(c,u,btrim(p_payload#>>'{owner,name}'),btrim(p_payload#>>'{owner,phone}')) RETURNING id INTO oid;
 END IF;
 IF pid IS NULL THEN
  INSERT INTO public.properties(company_id,added_by,title,type,area,price,branch_key,owner_id)
  VALUES(c,u,btrim(p_payload#>>'{property,title}'),coalesce(nullif(p_payload#>>'{property,type}',''),'villa'),btrim(p_payload#>>'{property,area}'),(p_payload#>>'{property,price}')::numeric,branch,oid) RETURNING id INTO pid;
 ELSIF oid IS NOT NULL THEN
  IF prop_owner IS NOT NULL AND prop_owner<>oid THEN RAISE EXCEPTION 'property_owner_already_linked' USING ERRCODE='22023'; END IF;
  UPDATE public.properties SET owner_id=oid WHERE id=pid AND owner_id IS NULL;
 END IF;
 d.client_id:=cid; d.property_id:=pid; d.agent_id:=aid;
 IF dp ? 'deal_value' THEN d.deal_value:=nullif(dp->>'deal_value','')::numeric; END IF;
 IF dp ? 'notes' THEN d.notes:=nullif(btrim(dp->>'notes'),''); END IF;
 IF dp ? 'closed_on' THEN
  sale_day:=nullif(dp->>'closed_on','')::date;
  IF sale_day IS DISTINCT FROM (old_d.closed_at AT TIME ZONE 'Asia/Muscat')::date THEN d.closed_at:=(sale_day+time '12:00') AT TIME ZONE 'Asia/Muscat'; END IF;
 END IF;
 -- Business dates are never stored in created_at. Original authorship/date survive edits.
 d.created_at:=coalesce(d.created_at,now()); d.updated_at:=clock_timestamp();
 actual_visit:=nullif(dp->>'visit_date','')::date;
 vid:=CASE WHEN actual_visit IS NOT NULL AND nullif(dp->>'viewing_id','') IS NULL THEN NULL ELSE coalesce(nullif(dp->>'viewing_id','')::uuid,d.viewing_id) END;
 IF vid IS NOT NULL THEN
  SELECT request_id INTO rid FROM public.viewings v WHERE v.id=vid AND v.company_id=c AND v.client_id=cid AND v.property_id=pid AND (v.status='done' OR (vid=old_d.viewing_id AND (d.stage NOT IN('closed','commission_collected') OR (d.entry_mode='legacy' AND old_d.stage IN('closed','commission_collected')))))
   AND (role_name IN('owner','manager') OR v.agent_id=u) AND (v.request_id IS NULL OR crm_repair_private.can_access_request(c,v.request_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'completed_viewing_not_allowed' USING ERRCODE='42501'; END IF;
 ELSIF actual_visit IS NOT NULL THEN
  IF actual_visit>(now() AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'completed_visit_cannot_be_future' USING ERRCODE='22023'; END IF;
  IF NOT is_new THEN
   INSERT INTO crm_repair_private.deal_workflow_context(transaction_id,user_id,company_id,client_id,property_id,deal_id)
   VALUES(txid_current(),u,c,cid,pid,d.id);
  END IF;
  visit_result:=public.crm_save_viewing_atomic(jsonb_build_object('client_id',cid,'property_id',pid,'agent_id',aid,
   'viewing_date',actual_visit,'viewing_time',NULL,'status','done','time_unknown',true,'pipeline_outcome',NULL),p_idempotency_key);
  DELETE FROM crm_repair_private.deal_workflow_context WHERE transaction_id=txid_current() AND user_id=u;
  vid:=(visit_result->>'viewing_id')::uuid; rid:=(visit_result#>>'{viewing,request_id}')::uuid;
 END IF;
 -- A visit already has a pipeline card. Reuse it rather than creating a second sale journey.
 IF is_new AND vid IS NOT NULL THEN
  SELECT id INTO generated_id FROM public.deals WHERE company_id=c AND viewing_id=vid ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF generated_id IS NOT NULL THEN
   IF NOT crm_repair_private.can_access_deal_workflow(generated_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
   SELECT * INTO old_d FROM public.deals WHERE id=generated_id FOR UPDATE;
   IF old_d.stage IN('closed','commission_collected') THEN RAISE EXCEPTION 'visit_deal_already_completed_open_existing' USING ERRCODE='22023'; END IF;
   d.id:=generated_id; d.created_at:=old_d.created_at; is_new:=false;
   d.agent_id:=coalesce(nullif(dp->>'agent_id','')::uuid,old_d.agent_id,aid); aid:=d.agent_id;
   d.notes:=CASE WHEN nullif(btrim(d.notes),'') IS NULL THEN old_d.notes WHEN old_d.notes IS NULL THEN d.notes ELSE old_d.notes||E'\n'||d.notes END;
   d.deal_value:=coalesce(d.deal_value,old_d.deal_value);
   d.commission_total:=old_d.commission_total; d.broker_id:=old_d.broker_id; d.broker_commission:=old_d.broker_commission;
   d.company_share:=old_d.company_share; d.agent_share:=old_d.agent_share; d.commission_status:=old_d.commission_status;
   d.commission_received_at:=old_d.commission_received_at; d.employee_commission_percent:=old_d.employee_commission_percent;
   -- Blank fields on a new-entry screen are not an instruction to erase an existing card's finance.
   f:=jsonb_strip_nulls(f);
  END IF;
 END IF;
 d.viewing_id:=vid; d.request_id:=CASE WHEN vid IS DISTINCT FROM old_d.viewing_id AND rid IS NOT NULL THEN rid ELSE coalesce(d.request_id,rid) END;
 IF d.stage='lost' THEN
  d.lost_reason_id:=coalesce(nullif(dp->>'lost_reason_id','')::uuid,d.lost_reason_id);
  IF (is_new OR old_d.stage IS DISTINCT FROM 'lost') AND d.lost_reason_id IS NULL THEN RAISE EXCEPTION 'main_loss_reason_required' USING ERRCODE='22023'; END IF;
  IF d.lost_reason_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=d.lost_reason_id AND (company_id IS NULL OR company_id=c) AND (is_active IS TRUE OR id=old_d.lost_reason_id)) THEN RAISE EXCEPTION 'loss_reason_not_allowed' USING ERRCODE='22023'; END IF;
  IF dp ? 'lost_reason_note' THEN d.lost_reason_note:=nullif(btrim(dp->>'lost_reason_note'),''); END IF;
  d.lost_from_stage:=coalesce(d.lost_from_stage,old_d.stage,'new'); d.lost_at:=coalesce(d.lost_at,now());
 ELSE
  d.lost_reason_id:=NULL;d.lost_reason_note:=NULL;d.lost_from_stage:=NULL;d.lost_at:=NULL;
 END IF;
 IF f IS NOT NULL AND f<>'null'::jsonb THEN
  IF d.stage='lost' THEN RAISE EXCEPTION 'loss_finance_edit_not_allowed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(f)<>'object' THEN RAISE EXCEPTION 'invalid_financial_payload' USING ERRCODE='22023'; END IF;
  IF f ? 'commission_total' THEN d.commission_total:=nullif(f->>'commission_total','')::numeric; END IF;
  IF f ? 'broker_commission' THEN d.broker_commission:=nullif(f->>'broker_commission','')::numeric; END IF;
  IF f ? 'employee_commission_percent' THEN d.employee_commission_percent:=nullif(f->>'employee_commission_percent','')::numeric; END IF;
  IF f ? 'broker_id' THEN d.broker_id:=nullif(f->>'broker_id','')::uuid; END IF;
  IF d.broker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.owners WHERE id=d.broker_id AND company_id=c) THEN RAISE EXCEPTION 'broker_not_allowed' USING ERRCODE='42501'; END IF;
  -- A loaded percentage is not an instruction to recalculate stored history.
  -- Only an actual edit to allocation terms changes the two recorded shares.
  commission_terms_changed:=d.commission_total IS DISTINCT FROM old_d.commission_total
   OR d.broker_commission IS DISTINCT FROM old_d.broker_commission
   OR d.employee_commission_percent IS DISTINCT FROM old_d.employee_commission_percent
   OR (d.employee_commission_percent IS NULL AND f ? 'agent_share'
       AND nullif(f->>'agent_share','')::numeric IS DISTINCT FROM old_d.agent_share);
  IF commission_terms_changed THEN
   IF d.employee_commission_percent IS NOT NULL THEN
    d.agent_share:=round((coalesce(d.commission_total,0)-coalesce(d.broker_commission,0))*d.employee_commission_percent/100,3);
   ELSIF f ? 'agent_share' THEN d.agent_share:=nullif(f->>'agent_share','')::numeric; END IF;
   d.company_share:=CASE WHEN d.commission_total IS NULL THEN NULL ELSE d.commission_total-coalesce(d.broker_commission,0)-coalesce(d.agent_share,0) END;
  END IF;
  IF coalesce(d.commission_total,0)<0 OR coalesce(d.broker_commission,0)<0 OR coalesce(d.agent_share,0)<0 OR coalesce(d.company_share,0)<0 OR coalesce(d.broker_commission,0)+coalesce(d.agent_share,0)>coalesce(d.commission_total,0) THEN RAISE EXCEPTION 'invalid_commission_amounts' USING ERRCODE='22023'; END IF;
  IF f ? 'commission_status' THEN d.commission_status:=f->>'commission_status'; END IF;
  -- A receipt ledger owns its cumulative amount and last actual receipt date.
  IF f ? 'commission_received_on' AND NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_commission_receipts WHERE deal_id=d.id) THEN
   IF nullif(f->>'commission_received_on','')::date IS DISTINCT FROM (old_d.commission_received_at AT TIME ZONE 'Asia/Muscat')::date THEN d.commission_received_at:=(nullif(f->>'commission_received_on','')::date+time '12:00') AT TIME ZONE 'Asia/Muscat'; END IF;
  END IF;
 END IF;
 d.commission_status:=coalesce(d.commission_status,'pending');
 IF d.stage='commission_collected' THEN d.commission_status:='received'; END IF;
 IF d.commission_status NOT IN('pending','received') THEN RAISE EXCEPTION 'invalid_commission_status' USING ERRCODE='22023'; END IF;
 IF is_new THEN
  INSERT INTO public.deals(id,company_id,client_id,property_id,agent_id,stage,deal_value,notes,closed_at,created_at,updated_at,request_id,viewing_id,lost_reason_id,lost_reason_note,lost_from_stage,lost_at,entry_mode,commission_total,broker_id,broker_commission,company_share,agent_share,commission_status,commission_received_at,employee_commission_percent)
  VALUES(d.id,c,cid,pid,aid,d.stage,d.deal_value,d.notes,d.closed_at,d.created_at,d.updated_at,d.request_id,d.viewing_id,d.lost_reason_id,d.lost_reason_note,d.lost_from_stage,d.lost_at,d.entry_mode,d.commission_total,d.broker_id,d.broker_commission,d.company_share,d.agent_share,d.commission_status,d.commission_received_at,d.employee_commission_percent);
 ELSE
  UPDATE public.deals SET stage=d.stage,agent_id=d.agent_id,deal_value=d.deal_value,notes=d.notes,closed_at=d.closed_at,updated_at=d.updated_at,request_id=d.request_id,viewing_id=d.viewing_id,lost_reason_id=d.lost_reason_id,lost_reason_note=d.lost_reason_note,lost_from_stage=d.lost_from_stage,lost_at=d.lost_at,entry_mode=d.entry_mode,commission_total=d.commission_total,broker_id=d.broker_id,broker_commission=d.broker_commission,company_share=d.company_share,agent_share=d.agent_share,commission_status=d.commission_status,commission_received_at=d.commission_received_at,employee_commission_percent=d.employee_commission_percent WHERE id=d.id;
 END IF;
 PERFORM crm_repair_private.save_deal_milestones(d.id,dp,p_idempotency_key,to_jsonb(old_d));
 SELECT updated_at INTO d.updated_at FROM public.deals WHERE id=d.id;
 result:=jsonb_build_object('ok',true,'deal_id',d.id,'client_id',cid,'property_id',pid,'viewing_id',vid,'updated_at',d.updated_at,'replayed',false);
 INSERT INTO crm_repair_private.deal_save_operations(user_id,operation_key,company_id,payload_hash,deal_id,result) VALUES(u,p_idempotency_key,c,ph,d.id,result);
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.get_deal_workflow(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.deals%rowtype; v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT crm_repair_private.can_access_deal_workflow(p_deal_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.deals WHERE id=p_deal_id;
 v:=jsonb_build_object('id',d.id,'company_id',d.company_id,'client_id',d.client_id,'property_id',d.property_id,
 'agent_id',d.agent_id,'stage',d.stage,'deal_value',d.deal_value,'notes',d.notes,'closed_at',d.closed_at,
 'created_at',d.created_at,'updated_at',d.updated_at,'request_id',d.request_id,'viewing_id',d.viewing_id,
 'lost_reason_id',d.lost_reason_id,'lost_reason_note',d.lost_reason_note,'lost_from_stage',d.lost_from_stage,
 'lost_at',d.lost_at,'entry_mode',d.entry_mode);
 IF public.my_role()='owner' THEN v:=v||jsonb_build_object('commission_total',d.commission_total,'broker_id',d.broker_id,
 'broker_commission',d.broker_commission,'company_share',d.company_share,'agent_share',d.agent_share,
 'commission_status',d.commission_status,'commission_received_at',d.commission_received_at,
 'employee_commission_percent',d.employee_commission_percent); END IF;
 v:=v||jsonb_build_object('deposit_amount',d.deposit_amount,'reservation_confirmed_at',d.reservation_confirmed_at,
 'reservation_reference',d.reservation_reference,'reservation_evidence_note',d.reservation_evidence_note,'reservation_cancelled_at',d.reservation_cancelled_at,
 'reservation_cancellation_reason',d.reservation_cancellation_reason,
 'reservation_recorded_by',(SELECT actor_id FROM crm_repair_private.deal_milestone_events WHERE deal_id=d.id AND event_type='reservation_confirmed_at' ORDER BY recorded_at LIMIT 1),
 'reservation_recorded_by_name',(SELECT p.full_name FROM crm_repair_private.deal_milestone_events x JOIN public.profiles p ON p.id=x.actor_id AND p.company_id=x.company_id WHERE x.deal_id=d.id AND x.event_type='reservation_confirmed_at' ORDER BY x.recorded_at LIMIT 1),
 'reservation_recorded_at',(SELECT recorded_at FROM crm_repair_private.deal_milestone_events WHERE deal_id=d.id AND event_type='reservation_confirmed_at' ORDER BY recorded_at LIMIT 1));
 IF public.my_role()='owner' THEN v:=v||jsonb_build_object('expected_company_commission_at_reservation',d.expected_company_commission_at_reservation,
 'commission_entitled_at',d.commission_entitled_at,'company_commission_received_amount',d.company_commission_received_amount,
 'company_commission_remaining',greatest(0,coalesce(crm_repair_private.recorded_company_commission(d),d.expected_company_commission_at_reservation,0)-coalesce(d.company_commission_received_amount,CASE WHEN d.commission_status='received' OR d.stage='commission_collected' THEN coalesce(crm_repair_private.recorded_company_commission(d),0) ELSE 0 END)),
 'milestone_history',(SELECT coalesce(jsonb_agg(jsonb_build_object('event_type',x.event_type,'before',x.before_data,'after',x.after_data,'actor',p.full_name,'recorded_at',x.recorded_at) ORDER BY x.recorded_at,x.id),'[]'::jsonb) FROM crm_repair_private.deal_milestone_events x LEFT JOIN public.profiles p ON p.id=x.actor_id AND p.company_id=x.company_id WHERE x.deal_id=d.id),
 'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('received_on',received_on,'amount',amount,'source_note',source_note) ORDER BY received_on,recorded_at),'[]'::jsonb) FROM crm_repair_private.deal_commission_receipts WHERE deal_id=d.id));END IF;
 RETURN jsonb_build_object('deal',v);
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.deal_period_metrics(p_from date, p_to date)
 RETURNS TABLE(employee_id uuid, reservations bigint, active_reservations bigint, cancelled_reservations bigint, expected_commission numeric, unknown_expected_commission bigint, commission_collected numeric, receipt_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid:=public.my_company();u uuid:=auth.uid();r text:=public.my_role();start_at timestamptz:=p_from::timestamp AT TIME ZONE 'Asia/Muscat';end_at timestamptz:=p_to::timestamp AT TIME ZONE 'Asia/Muscat';
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN('owner','manager','agent') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND company_id=c AND is_active) THEN RAISE EXCEPTION 'performance_not_allowed' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'invalid_performance_period' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH allowed AS MATERIALIZED (
  SELECT d.*,coalesce(p.branch_key,cl.lead_route) report_branch
  FROM public.deals d LEFT JOIN public.properties p ON p.id=d.property_id AND p.company_id=d.company_id
  LEFT JOIN public.clients cl ON cl.id=d.client_id AND cl.company_id=d.company_id
  WHERE d.company_id=c AND crm_repair_private.investment_row_allowed(d.company_id,to_jsonb(d))
   AND NOT crm_repair_private.investment_link_is_private(d.company_id,to_jsonb(d))
   AND (r<>'agent' OR (crm_repair_private.staff_can_access_branch(d.company_id,coalesce(p.branch_key,cl.lead_route)) AND (d.client_id IS NULL OR crm_repair_private.can_access_client(d.company_id,d.client_id)) AND (d.request_id IS NULL OR crm_repair_private.can_access_request(d.company_id,d.request_id))))
 ), credits AS (
  SELECT crm_repair_private.performance_employee(d.company_id,d.report_branch,d.reservation_confirmed_at,d.agent_id) emp,
   1::bigint booked,(CASE WHEN d.reservation_cancelled_at IS NULL AND d.stage<>'lost' THEN 1 ELSE 0 END)::bigint active,
   (CASE WHEN d.reservation_cancelled_at IS NOT NULL OR d.stage='lost' THEN 1 ELSE 0 END)::bigint cancelled,
   coalesce(d.expected_company_commission_at_reservation,0) expected,
   (CASE WHEN d.expected_company_commission_at_reservation IS NULL THEN 1 ELSE 0 END)::bigint unknown_amount,0::numeric collected,0::bigint receipts
  FROM allowed d WHERE d.reservation_confirmed_at>=start_at AND d.reservation_confirmed_at<end_at AND nullif(btrim(d.reservation_evidence_note),'') IS NOT NULL AND d.deposit_amount>0
  UNION ALL
  SELECT crm_repair_private.performance_employee(d.company_id,d.report_branch,x.received_on::timestamp AT TIME ZONE 'Asia/Muscat',d.agent_id),0,0,0,0,0,x.amount,1
  FROM allowed d JOIN crm_repair_private.deal_commission_receipts x ON x.deal_id=d.id AND x.company_id=d.company_id WHERE x.received_on>=p_from AND x.received_on<p_to
  UNION ALL
  SELECT crm_repair_private.performance_employee(d.company_id,d.report_branch,d.commission_received_at,d.agent_id),0,0,0,0,0,
   coalesce(d.company_commission_received_amount,crm_repair_private.recorded_company_commission((SELECT original FROM public.deals original WHERE original.id=d.id)),0),1
  FROM allowed d WHERE NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_commission_receipts x WHERE x.deal_id=d.id)
   AND d.commission_received_at>=start_at AND d.commission_received_at<end_at
   AND (d.company_commission_received_amount IS NOT NULL OR d.commission_status='received' OR d.stage='commission_collected')
 ) SELECT emp,sum(booked)::bigint,sum(active)::bigint,sum(cancelled)::bigint,sum(expected),sum(unknown_amount)::bigint,sum(collected),sum(receipts)::bigint
 FROM credits WHERE r<>'agent' OR emp=u GROUP BY emp;
END $function$
;


-- Weekly qualified additions keep credit after a sale. Current active inventory
-- still requires available status; archived rows stay excluded from both.
CREATE OR REPLACE FUNCTION public.crm_employee_target_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();today date:=(now() AT TIME ZONE 'Asia/Muscat')::date;wk date;mo date;result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 wk:=today-extract(dow FROM today)::int;mo:=date_trunc('month',today)::date;
 WITH employees AS (
  SELECT e.id,e.full_name,lr.route_key branch FROM public.company_lead_routes lr JOIN public.profiles e ON e.id=lr.assigned_to AND e.company_id=lr.company_id
  WHERE lr.company_id=c AND lr.route_key IN ('muscat','barka') AND lr.is_active AND NOT lr.owner_only_inbox AND e.is_active AND e.role='agent' AND (r<>'agent' OR e.id=u)
 ), counts AS (
  SELECT e.*,t.employee_id target_id,
  CASE WHEN t.employee_id IS NULL THEN 10 ELSE t.inventory_target END inventory_goal,
  CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions_goal,
  CASE WHEN t.employee_id IS NULL THEN 10 ELSE t.daily_followups_target END followups_goal,
  CASE WHEN t.employee_id IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings_goal,
  CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.reservations_target END bookings_goal,
  CASE WHEN t.employee_id IS NULL THEN 4000 ELSE t.booking_commission_target END commission_goal,
  (SELECT count(DISTINCT p.id) FROM public.properties p WHERE p.company_id=c AND p.branch_key=e.branch AND p.status='available' AND NOT coalesce(p.archived,false) AND p.price>0 AND p.availability_checked_at IS NOT NULL AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))) inventory,
  (SELECT count(DISTINCT p.id) FROM public.properties p WHERE p.company_id=c AND p.branch_key=e.branch AND NOT coalesce(p.archived,false) AND p.price>0 AND p.availability_checked_at IS NOT NULL AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date BETWEEN wk AND today AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))) additions,
  (SELECT count(DISTINCT a.client_id) FROM public.activities a JOIN public.clients cl ON cl.id=a.client_id AND cl.company_id=a.company_id
   WHERE a.company_id=c AND crm_repair_private.performance_employee(c,cl.lead_route,coalesce(a.occurred_at,a.created_at),a.user_id)=e.id
   AND cl.lead_route=e.branch AND a.actor_type='human' AND nullif(btrim(a.outcome),'') IS NOT NULL AND a.type IN ('call','followup','meeting','whatsapp','contact','email') AND (coalesce(a.occurred_at,a.created_at) AT TIME ZONE 'Asia/Muscat')::date=today
   AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(a))) followups,
  (SELECT count(DISTINCT v.id) FROM public.viewings v JOIN public.properties p ON p.id=v.property_id AND p.company_id=v.company_id
   WHERE v.company_id=c AND p.branch_key=e.branch AND crm_repair_private.performance_employee(c,p.branch_key,v.viewing_date::timestamp AT TIME ZONE 'Asia/Muscat',v.agent_id)=e.id AND v.status='done' AND NOT coalesce(v.archived,false) AND v.viewing_date BETWEEN wk AND today AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(v))) viewings,
  coalesce(b.reservations,0) bookings,coalesce(b.active_reservations,0) live_bookings,coalesce(b.cancelled_reservations,0) cancelled_bookings,
  coalesce(b.expected_commission,0) expected_commission,coalesce(b.commission_collected,0) collected_commission
  FROM employees e LEFT JOIN public.employee_monthly_targets t ON t.company_id=c AND t.employee_id=e.id AND t.month_start=mo
  LEFT JOIN crm_repair_private.deal_period_metrics(mo,today+1) b ON b.employee_id=e.id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'branch',branch,'inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,
  'bookings',bookings,'live_bookings',live_bookings,'cancelled_bookings',cancelled_bookings,
  'expected_commission',CASE WHEN r='owner' OR id=u THEN expected_commission END,'collected_commission',CASE WHEN r='owner' OR id=u THEN collected_commission END,
  'goals',jsonb_build_object('inventory',inventory_goal,'new_properties',additions_goal,'followups',followups_goal,'viewings',viewings_goal,'bookings',bookings_goal,'expected_commission',commission_goal),
  'sales_goal_met',((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))) ORDER BY branch),'[]'::jsonb) INTO result FROM counts;
 RETURN jsonb_build_object('today',today,'week_start',wk,'week_end',wk+6,'month_start',mo,'month_end',(mo+interval '1 month - 1 day')::date,'employees',result);
END $$;
REVOKE ALL ON FUNCTION public.crm_employee_target_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_employee_target_snapshot() TO authenticated;

-- Owner-only company view includes private investment, never exposed to staff.
-- p_to is exclusive; undated received history is diagnosed, not put in a month.
CREATE OR REPLACE FUNCTION public.crm_commission_report(p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.my_company();u uuid:=auth.uid();v jsonb;
 start_at timestamptz:=p_from::timestamp AT TIME ZONE 'Asia/Muscat';
 end_at timestamptz:=p_to::timestamp AT TIME ZONE 'Asia/Muscat';
BEGIN
 IF c IS NULL OR u IS NULL OR public.my_role() IS DISTINCT FROM 'owner'
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND company_id=c AND role='owner' AND is_active IS TRUE)
 THEN RAISE EXCEPTION 'owner_only_financial_report' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'invalid_performance_period' USING ERRCODE='22023';END IF;
 WITH amounts AS MATERIALIZED (
  SELECT d.*,crm_repair_private.recorded_company_commission(d) company_gross,
   coalesce(r.receipt_count,0) receipt_count,r.total_received,r.period_received
  FROM public.deals d LEFT JOIN LATERAL (
   SELECT count(*) receipt_count,sum(x.amount) total_received,
    sum(x.amount) FILTER(WHERE x.received_on>=p_from AND x.received_on<p_to) period_received
   FROM crm_repair_private.deal_commission_receipts x WHERE x.deal_id=d.id AND x.company_id=d.company_id
  ) r ON true WHERE d.company_id=c
 ), values_by_deal AS (
  SELECT a.*,
   (reservation_confirmed_at>=start_at AND reservation_confirmed_at<end_at
    AND deposit_amount>0 AND nullif(btrim(reservation_evidence_note),'') IS NOT NULL) booked_in_period,
   (commission_status='received' OR stage='commission_collected' OR coalesce(company_commission_received_amount,0)>0) has_received,
   CASE WHEN receipt_count>0 THEN total_received
    WHEN company_commission_received_amount IS NOT NULL THEN company_commission_received_amount
    WHEN commission_status='received' OR stage='commission_collected' THEN company_gross ELSE 0 END actual_received
  FROM amounts a
 ) SELECT jsonb_build_object('from',p_from,'to',p_to,
  'bookings',count(*) FILTER(WHERE booked_in_period),
  'expected_commission',coalesce(sum(expected_company_commission_at_reservation) FILTER(WHERE booked_in_period),0),
  'unknown_expected_commission_deals',count(*) FILTER(WHERE booked_in_period AND expected_company_commission_at_reservation IS NULL),
  'collected_commission',coalesce(sum(CASE WHEN receipt_count>0 THEN coalesce(period_received,0)
   WHEN has_received AND commission_received_at>=start_at AND commission_received_at<end_at THEN coalesce(actual_received,0) ELSE 0 END),0),
  'outstanding_commission',coalesce(sum(CASE WHEN stage<>'lost' AND reservation_cancelled_at IS NULL
   AND NOT(receipt_count=0 AND has_received AND actual_received IS NULL)
   THEN greatest(0,coalesce(company_gross,expected_company_commission_at_reservation,0)-coalesce(actual_received,0)) ELSE 0 END),0),
  'undated_received_deals',count(*) FILTER(WHERE receipt_count=0 AND has_received AND commission_received_at IS NULL),
  'unknown_received_amount_deals',count(*) FILTER(WHERE receipt_count=0 AND has_received AND actual_received IS NULL)
 ) INTO v FROM values_by_deal;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.crm_commission_report(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_commission_report(date,date) TO authenticated;

UPDATE crm_repair_private.audit26_catalog_backup b SET applied_definition=pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.oid::regprocedure::text=b.identity;
NOTIFY pgrst,'reload schema';
