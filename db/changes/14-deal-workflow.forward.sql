-- Prepared review change. Requires changes 01–13. No historical row backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS commission_received_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS employee_commission_percent numeric(5,2);
ALTER TABLE public.deals ADD CONSTRAINT deals_entry_mode_check CHECK(entry_mode IN('legacy','current','historical'));
ALTER TABLE public.deals ADD CONSTRAINT deals_employee_commission_percent_check CHECK(employee_commission_percent BETWEEN 0 AND 100);
GRANT SELECT(entry_mode) ON public.deals TO authenticated;

CREATE TABLE crm_repair_private.deal_save_operations(
 user_id uuid NOT NULL REFERENCES public.profiles(id), operation_key uuid NOT NULL,
 company_id uuid NOT NULL REFERENCES public.companies(id), payload_hash text NOT NULL,
 deal_id uuid NOT NULL REFERENCES public.deals(id), result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_key));
ALTER TABLE crm_repair_private.deal_save_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.deal_save_operations FROM PUBLIC,anon,authenticated;

-- Transaction-local routing for visit triggers. No client can write or read this context.
CREATE TABLE crm_repair_private.deal_workflow_context(
 transaction_id bigint NOT NULL,user_id uuid NOT NULL,company_id uuid NOT NULL,
 client_id uuid NOT NULL,property_id uuid NOT NULL,deal_id uuid NOT NULL REFERENCES public.deals(id),
 PRIMARY KEY(transaction_id,user_id));
ALTER TABLE crm_repair_private.deal_workflow_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.deal_workflow_context FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_repair_private.can_access_deal_workflow(p_deal_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.deals d JOIN public.profiles u ON u.company_id=d.company_id
 WHERE d.id=p_deal_id AND u.id=auth.uid() AND u.is_active IS TRUE AND
 (u.role IN('owner','manager') OR (u.role='agent' AND d.agent_id=u.id
 AND (d.client_id IS NULL OR crm_repair_private.can_access_client(d.company_id,d.client_id))
 AND (d.request_id IS NULL OR crm_repair_private.can_access_request(d.company_id,d.request_id))
 AND (d.property_id IS NULL OR EXISTS(SELECT 1 FROM public.properties p WHERE p.id=d.property_id AND p.company_id=d.company_id
 AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))))))
$$;
REVOKE ALL ON FUNCTION crm_repair_private.can_access_deal_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.can_access_deal_workflow(uuid) TO authenticated;

-- The private implementation reads protected columns, then explicitly redacts all finance for staff.
CREATE FUNCTION crm_repair_private.get_deal_workflow(p_deal_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 RETURN jsonb_build_object('deal',v);
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.get_deal_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.get_deal_workflow(uuid) TO authenticated;
CREATE FUNCTION public.crm_get_deal_workflow(p_deal_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT crm_repair_private.get_deal_workflow(p_deal_id)
$$;
REVOKE ALL ON FUNCTION public.crm_get_deal_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_get_deal_workflow(uuid) TO authenticated;

-- Enforce the same business evidence on old direct stage updates and new atomic saves.
-- Existing completed legacy rows remain editable without inventing missing dates.
CREATE FUNCTION crm_repair_private.guard_deal_workflow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE completed boolean; was_completed boolean:=false; vd date; finance_changed boolean;
BEGIN
 IF TG_OP='INSERT' AND NEW.entry_mode='legacy' THEN NEW.entry_mode:='current'; END IF;
 IF TG_OP='UPDATE' AND NEW.entry_mode='legacy' AND OLD.entry_mode<>'legacy' THEN RAISE EXCEPTION 'cannot_downgrade_deal_to_legacy' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN was_completed:=OLD.stage IN('closed','commission_collected'); END IF;
 completed:=NEW.stage IN('closed','commission_collected');
 IF TG_OP='UPDATE' AND NEW.entry_mode='legacy' AND completed AND NOT was_completed THEN NEW.entry_mode:='current'; END IF;
 IF NEW.entry_mode<>'legacy' AND completed THEN
  IF NEW.closed_at IS NULL THEN RAISE EXCEPTION 'sale_date_required' USING ERRCODE='22023'; END IF;

  IF NEW.entry_mode='current' AND NOT EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=NEW.viewing_id
   AND v.company_id=NEW.company_id AND v.client_id=NEW.client_id AND v.property_id=NEW.property_id AND v.status='done' AND coalesce(v.archived,false)=false) THEN
   RAISE EXCEPTION 'completed_visit_required_for_current_deal' USING ERRCODE='22023';
  END IF;
  IF NEW.viewing_id IS NOT NULL THEN
   SELECT viewing_date INTO vd FROM public.viewings WHERE id=NEW.viewing_id AND company_id=NEW.company_id AND client_id=NEW.client_id AND property_id=NEW.property_id AND status='done';
   IF vd IS NULL OR vd>(NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'visit_must_precede_sale' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF NEW.closed_at IS NOT NULL AND (NEW.entry_mode<>'legacy' OR (TG_OP='UPDATE' AND NEW.closed_at IS DISTINCT FROM OLD.closed_at)) AND (NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'sale_date_cannot_be_future' USING ERRCODE='22023'; END IF;
 IF NEW.entry_mode='current' AND (NEW.commission_status='received' OR NEW.stage='commission_collected') AND NEW.commission_received_at IS NULL THEN
  RAISE EXCEPTION 'commission_received_date_required' USING ERRCODE='22023';
 END IF;
 IF (NEW.entry_mode<>'legacy' OR (TG_OP='UPDATE' AND (NEW.commission_received_at IS DISTINCT FROM OLD.commission_received_at OR NEW.closed_at IS DISTINCT FROM OLD.closed_at))) AND NEW.commission_received_at IS NOT NULL AND (NEW.closed_at IS NULL OR
 (NEW.commission_received_at AT TIME ZONE 'Asia/Muscat')::date<(NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date OR
 (NEW.commission_received_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date) THEN
  RAISE EXCEPTION 'commission_date_must_follow_sale' USING ERRCODE='22023';
 END IF;
 IF auth.uid() IS NOT NULL AND coalesce(public.my_role(),'')<>'owner' THEN
  IF TG_OP='INSERT' THEN finance_changed:= NEW.stage='commission_collected' OR NEW.commission_total IS NOT NULL OR NEW.broker_commission IS NOT NULL OR NEW.agent_share IS NOT NULL OR NEW.company_share IS NOT NULL OR NEW.employee_commission_percent IS NOT NULL OR NEW.commission_received_at IS NOT NULL OR coalesce(NEW.commission_status,'pending')<>'pending';
  ELSE finance_changed:=NEW.stage IS DISTINCT FROM OLD.stage AND (NEW.stage='commission_collected' OR OLD.stage='commission_collected')
   OR NEW.commission_total IS DISTINCT FROM OLD.commission_total OR NEW.broker_commission IS DISTINCT FROM OLD.broker_commission
   OR NEW.agent_share IS DISTINCT FROM OLD.agent_share OR NEW.company_share IS DISTINCT FROM OLD.company_share
   OR NEW.employee_commission_percent IS DISTINCT FROM OLD.employee_commission_percent OR NEW.commission_received_at IS DISTINCT FROM OLD.commission_received_at
   OR NEW.commission_status IS DISTINCT FROM OLD.commission_status; END IF;
  IF finance_changed THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_deal_workflow() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_deal_workflow BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_deal_workflow();

-- A completion is not evidence of an unknown negotiation date, particularly on imported history.
CREATE OR REPLACE FUNCTION public.sync_request_from_deal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_at timestamptz:=coalesce(NEW.updated_at,NEW.created_at,now());
BEGIN
 IF NEW.request_id IS NULL THEN RETURN NEW; END IF;
 UPDATE public.client_requests r SET
 opportunity_opened_at=CASE WHEN NEW.entry_mode<>'historical' AND NEW.stage IN('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer') AND r.opportunity_opened_at IS NULL THEN v_at ELSE r.opportunity_opened_at END,
 negotiation_started_at=CASE WHEN NEW.entry_mode<>'historical' AND NEW.stage='negotiation' AND r.negotiation_started_at IS NULL THEN v_at ELSE r.negotiation_started_at END,
 contract_completed_at=CASE WHEN NEW.stage IN('ownership_transfer','closed','commission_collected') AND r.contract_completed_at IS NULL THEN NEW.closed_at ELSE r.contract_completed_at END,
 closed_won_at=CASE WHEN NEW.stage IN('closed','commission_collected') AND r.closed_won_at IS NULL THEN NEW.closed_at ELSE r.closed_won_at END,
 updated_at=now() WHERE r.id=NEW.request_id AND r.company_id=NEW.company_id;
 RETURN NEW;
END $$;

CREATE FUNCTION crm_repair_private.save_deal_workflow(p_payload jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u uuid:=auth.uid(); c uuid:=public.my_company(); role_name text:=public.my_role(); dp jsonb:=p_payload->'deal'; f jsonb;
 old_d public.deals%rowtype; d public.deals%rowtype; op crm_repair_private.deal_save_operations%rowtype;
 pid uuid; cid uuid; oid uuid; vid uuid; rid uuid; aid uuid; branch text; prop_owner uuid; ph text; phone_value text;
 request_kind text; req_count integer; visit_result jsonb; generated_id uuid; actual_visit date; sale_day date; result jsonb; is_new boolean;
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
  IF d.employee_commission_percent IS NOT NULL THEN
   d.agent_share:=round((coalesce(d.commission_total,0)-coalesce(d.broker_commission,0))*d.employee_commission_percent/100,2);
  ELSIF f ? 'agent_share' THEN d.agent_share:=nullif(f->>'agent_share','')::numeric; END IF;
  IF f ? 'commission_total' OR f ? 'broker_commission' OR f ? 'employee_commission_percent' OR f ? 'agent_share' THEN
   d.company_share:=CASE WHEN d.commission_total IS NULL THEN NULL ELSE d.commission_total-coalesce(d.broker_commission,0)-coalesce(d.agent_share,0) END;
  END IF;
  IF coalesce(d.commission_total,0)<0 OR coalesce(d.broker_commission,0)<0 OR coalesce(d.agent_share,0)<0 OR coalesce(d.company_share,0)<0 OR coalesce(d.broker_commission,0)+coalesce(d.agent_share,0)>coalesce(d.commission_total,0) THEN RAISE EXCEPTION 'invalid_commission_amounts' USING ERRCODE='22023'; END IF;
  IF f ? 'commission_status' THEN d.commission_status:=f->>'commission_status'; END IF;
  IF f ? 'commission_received_on' THEN
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
 SELECT updated_at INTO d.updated_at FROM public.deals WHERE id=d.id;
 result:=jsonb_build_object('ok',true,'deal_id',d.id,'client_id',cid,'property_id',pid,'viewing_id',vid,'updated_at',d.updated_at,'replayed',false);
 INSERT INTO crm_repair_private.deal_save_operations(user_id,operation_key,company_id,payload_hash,deal_id,result) VALUES(u,p_idempotency_key,c,ph,d.id,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.save_deal_workflow(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.save_deal_workflow(jsonb,uuid) TO authenticated;
CREATE FUNCTION public.crm_save_deal_workflow(p_payload jsonb,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT crm_repair_private.save_deal_workflow(p_payload,p_idempotency_key)
$$;
REVOKE ALL ON FUNCTION public.crm_save_deal_workflow(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_save_deal_workflow(jsonb,uuid) TO authenticated;
CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS
 SELECT id,
    company_id,
    client_id,
    property_id,
    agent_id,
    stage,
    deal_value,
    deposit_amount,
    closing_probability,
    expected_close_date,
    bank_financing,
    notes,
    closed_at,
        CASE
            WHEN my_role() = 'owner'::text THEN company_commission
            ELSE NULL::numeric
        END AS company_commission,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_commission
            ELSE NULL::numeric
        END AS agent_commission,
    created_at,
    updated_at,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_total
            ELSE NULL::numeric
        END AS commission_total,
        CASE
            WHEN my_role() = 'owner'::text THEN company_share
            ELSE NULL::numeric
        END AS company_share,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_share
            ELSE NULL::numeric
        END AS agent_share,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_status
            ELSE NULL::text
        END AS commission_status,
    broker_id,
        CASE
            WHEN my_role() = 'owner'::text THEN broker_commission
            ELSE NULL::numeric
        END AS broker_commission,
    request_id,
    viewing_id,
    lost_reason_id,
    lost_reason_note,
    lost_from_stage,
    lost_at,
    entry_mode,
    CASE WHEN my_role()='owner' THEN commission_received_at ELSE NULL::timestamptz END AS commission_received_at,
    CASE WHEN my_role()='owner' THEN employee_commission_percent ELSE NULL::numeric END AS employee_commission_percent
   FROM deals t
  WHERE company_id = my_company() AND (property_id IS NULL OR (EXISTS ( SELECT 1
           FROM properties p
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id)));
REVOKE ALL ON public.crm_deals_access FROM PUBLIC,anon;
GRANT SELECT ON public.crm_deals_access TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
