-- SQL25: targeted audit repairs; no guessed historical booking or business-row cleanup.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit25_catalog_backup(identity text PRIMARY KEY,definition text NOT NULL,applied_definition text);
ALTER TABLE crm_repair_private.audit25_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit25_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.audit25_catalog_backup(identity,definition)
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname,p.proname) IN
 (('crm_repair_private','guard_reservation_milestones'),('crm_repair_private','audit_reservation_milestones'),
 ('crm_repair_private','save_deal_milestones'),('crm_repair_private','save_deal_workflow'),
 ('crm_repair_private','get_deal_workflow'),('crm_repair_private','deal_period_metrics'),
 ('public','crm_save_deal_workflow'),('public','crm_confirm_paid_reservation'),('public','crm_employee_target_snapshot'),('public','crm_employee_performance'))
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS crm_repair_private.audit25_business_before AS
SELECT 'deals'::text table_name,id,to_jsonb(d) row_data FROM public.deals d
UNION ALL SELECT 'deposits',id,to_jsonb(d) FROM public.deposits d;
ALTER TABLE crm_repair_private.audit25_business_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit25_business_before FROM PUBLIC,anon,authenticated,service_role;

-- Widen the existing OMR columns without changing their integer range or values.
-- The masking view deliberately reads with its owner's privileges; restore its
-- explicit tenant/branch/private predicates and financial CASE expressions.
DO $precision$
DECLARE v text;col text;
BEGIN
 v:=pg_get_viewdef('public.crm_deals_access'::regclass,true);
 INSERT INTO crm_repair_private.audit25_catalog_backup(identity,definition) VALUES('view:public.crm_deals_access',v) ON CONFLICT DO NOTHING;
 DROP VIEW public.crm_deals_access;
 FOREACH col IN ARRAY ARRAY['deal_value','deposit_amount','company_commission','agent_commission','commission_total','company_share','agent_share','broker_commission'] LOOP
  EXECUTE format('ALTER TABLE public.deals ALTER COLUMN %I TYPE numeric(13,3)',col);
 END LOOP;
 ALTER TABLE public.deposits ALTER COLUMN amount TYPE numeric(13,3);
 EXECUTE 'CREATE VIEW public.crm_deals_access WITH (security_barrier=true) AS '||v;
 REVOKE ALL ON public.crm_deals_access FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.crm_deals_access TO authenticated,service_role;
END $precision$;

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS reservation_reference text;
CREATE TABLE IF NOT EXISTS crm_repair_private.reservation_change_context(
 transaction_id bigint NOT NULL,deal_id uuid NOT NULL,actor_id uuid NOT NULL,reason text NOT NULL,
 PRIMARY KEY(transaction_id,deal_id));
ALTER TABLE crm_repair_private.reservation_change_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.reservation_change_context FROM PUBLIC,anon,authenticated,service_role;

-- Existing October targets are 10; the other approved targets have never been
-- persisted. Add their actual periods without repurposing old monthly fields.
ALTER TABLE public.employee_monthly_targets
 ADD COLUMN IF NOT EXISTS weekly_new_properties_target integer DEFAULT 2,
 ADD COLUMN IF NOT EXISTS daily_followups_target integer DEFAULT 10,
 ADD COLUMN IF NOT EXISTS weekly_viewings_target integer DEFAULT 5,
 ADD COLUMN IF NOT EXISTS reservations_target integer DEFAULT 2,
 ADD COLUMN IF NOT EXISTS booking_commission_target numeric(14,3) DEFAULT 4000;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='employee_current_goals_valid' AND conrelid='public.employee_monthly_targets'::regclass) THEN
  ALTER TABLE public.employee_monthly_targets ADD CONSTRAINT employee_current_goals_valid CHECK(
   weekly_new_properties_target BETWEEN 0 AND 1000 AND daily_followups_target BETWEEN 0 AND 1000
   AND weekly_viewings_target BETWEEN 0 AND 1000 AND reservations_target BETWEEN 0 AND 1000
   AND booking_commission_target>=0 AND booking_commission_target NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_reservation_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE changed boolean; old_json jsonb:='{}'; authorized_correction boolean; n numeric;
BEGIN
 authorized_correction:=public.my_role()='owner' AND EXISTS(SELECT 1 FROM crm_repair_private.reservation_change_context WHERE transaction_id=txid_current() AND deal_id=NEW.id AND actor_id=auth.uid() AND length(btrim(reason))>0);
 IF TG_OP='UPDATE' THEN
  old_json:=to_jsonb(OLD);
  IF OLD.reservation_confirmed_at IS NOT NULL AND NOT authorized_correction AND
   (NEW.reservation_confirmed_at IS DISTINCT FROM OLD.reservation_confirmed_at OR
    NEW.reservation_evidence_note IS DISTINCT FROM OLD.reservation_evidence_note OR
    NEW.deposit_amount IS DISTINCT FROM OLD.deposit_amount) THEN
   RAISE EXCEPTION 'original_reservation_is_immutable' USING ERRCODE='22023';
  END IF;
  IF OLD.reservation_cancelled_at IS NOT NULL AND NOT authorized_correction AND
   (NEW.reservation_cancelled_at IS DISTINCT FROM OLD.reservation_cancelled_at OR NEW.reservation_cancellation_reason IS DISTINCT FROM OLD.reservation_cancellation_reason) THEN
   RAISE EXCEPTION 'reservation_cancellation_is_immutable' USING ERRCODE='22023';
  END IF;
  -- A recorded loss cancels the live booking; the original monthly achievement remains.
  IF NEW.reservation_confirmed_at IS NOT NULL AND NEW.stage='lost' AND OLD.stage<>'lost' AND NEW.reservation_cancelled_at IS NULL THEN
   NEW.reservation_cancelled_at:=coalesce(NEW.lost_at,clock_timestamp());
   NEW.reservation_cancellation_reason:=coalesce(nullif(btrim(NEW.lost_reason_note),''),(SELECT label_ar FROM public.rejection_reasons WHERE id=NEW.lost_reason_id));
  END IF;
 END IF;
 FOREACH n IN ARRAY ARRAY[NEW.deposit_amount,NEW.expected_company_commission_at_reservation,NEW.company_commission_received_amount,NEW.commission_total,NEW.broker_commission,NEW.agent_share,NEW.company_share] LOOP
  IF n IS NOT NULL AND (n<0 OR n IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR n<>round(n,3)) THEN RAISE EXCEPTION 'invalid_omr_amount' USING ERRCODE='22023';END IF;
 END LOOP;
 changed:=NEW.reservation_confirmed_at IS DISTINCT FROM (old_json->>'reservation_confirmed_at')::timestamptz
 OR NEW.reservation_cancelled_at IS DISTINCT FROM (old_json->>'reservation_cancelled_at')::timestamptz
 OR NEW.expected_company_commission_at_reservation IS DISTINCT FROM (old_json->>'expected_company_commission_at_reservation')::numeric
 OR NEW.commission_entitled_at IS DISTINCT FROM (old_json->>'commission_entitled_at')::timestamptz
 OR NEW.closed_at IS DISTINCT FROM (old_json->>'closed_at')::timestamptz;
 changed:=changed OR NEW.deposit_amount IS DISTINCT FROM (old_json->>'deposit_amount')::numeric;
 IF NOT changed THEN RETURN NEW; END IF;
 IF NEW.reservation_confirmed_at IS NOT NULL AND
  (nullif(btrim(NEW.reservation_evidence_note),'') IS NULL OR NEW.deposit_amount IS NULL OR NEW.deposit_amount<=0 OR NEW.deposit_amount='NaN'::numeric OR
   (NEW.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date OR
   (NEW.closed_at IS NOT NULL AND NEW.reservation_confirmed_at>NEW.closed_at)) THEN
  RAISE EXCEPTION 'actual_paid_deposit_date_amount_and_source_required' USING ERRCODE='22023';
 END IF;
 IF NEW.expected_company_commission_at_reservation IS NOT NULL AND
  (NEW.expected_company_commission_at_reservation<0 OR NEW.expected_company_commission_at_reservation='NaN'::numeric) THEN RAISE EXCEPTION 'invalid_expected_commission' USING ERRCODE='22023';END IF;
 IF NEW.reservation_cancelled_at IS NOT NULL AND
  (NEW.reservation_confirmed_at IS NULL OR NEW.reservation_cancelled_at<NEW.reservation_confirmed_at OR
   (NEW.reservation_cancelled_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date OR nullif(btrim(NEW.reservation_cancellation_reason),'') IS NULL) THEN
  RAISE EXCEPTION 'cancellation_date_and_reason_required' USING ERRCODE='22023';END IF;
 IF NEW.commission_entitled_at IS NOT NULL AND
  (NEW.reservation_confirmed_at IS NOT NULL AND NEW.commission_entitled_at<NEW.reservation_confirmed_at OR
   (NEW.commission_entitled_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date) THEN RAISE EXCEPTION 'invalid_commission_entitlement_date' USING ERRCODE='22023';END IF;
 IF auth.uid() IS NOT NULL AND coalesce(public.my_role(),'')<>'owner' AND
  (NEW.expected_company_commission_at_reservation IS DISTINCT FROM (old_json->>'expected_company_commission_at_reservation')::numeric OR
   NEW.commission_entitled_at IS DISTINCT FROM (old_json->>'commission_entitled_at')::timestamptz) THEN
  RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.audit_reservation_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE before_row jsonb:='{}'; after_row jsonb; k text;
BEGIN
 IF TG_OP='UPDATE' THEN before_row:=to_jsonb(OLD);END IF;
 after_row:=to_jsonb(NEW);
 FOREACH k IN ARRAY ARRAY['reservation_confirmed_at','reservation_evidence_note','reservation_cancelled_at','reservation_cancellation_reason','expected_company_commission_at_reservation','commission_entitled_at','deposit_amount','reservation_reference','agent_id','commission_total','broker_commission','agent_share','company_share','commission_received_at','company_commission_received_amount','commission_status'] LOOP
  IF after_row->k IS DISTINCT FROM coalesce(before_row->k,'null'::jsonb) THEN
   INSERT INTO crm_repair_private.deal_milestone_events(company_id,deal_id,actor_id,event_type,before_data,after_data)
   VALUES(NEW.company_id,NEW.id,auth.uid(),k,jsonb_build_object(k,before_row->k),jsonb_build_object(k,after_row->k,'reason',(SELECT reason FROM crm_repair_private.reservation_change_context WHERE transaction_id=txid_current() AND deal_id=NEW.id AND actor_id=auth.uid())));
  END IF;
 END LOOP;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_confirm_paid_reservation(p_deal_id uuid, p_payment_date date, p_amount numeric, p_expected_company_commission numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.deals%rowtype; actor uuid:=auth.uid(); company uuid:=public.my_company(); role_name text:=public.my_role();
BEGIN
 IF actor IS NULL OR company IS NULL OR role_name NOT IN('owner','manager','agent') OR NOT crm_repair_private.can_access_deal_workflow(p_deal_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 IF p_payment_date IS NULL OR p_payment_date>(now() AT TIME ZONE 'Asia/Muscat')::date OR p_amount IS NULL OR p_amount<=0 OR p_amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR p_amount<>round(p_amount,3) THEN RAISE EXCEPTION 'actual_paid_deposit_date_and_amount_required' USING ERRCODE='22023';END IF;
 IF p_expected_company_commission IS NOT NULL AND (p_expected_company_commission<0 OR p_expected_company_commission IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR p_expected_company_commission<>round(p_expected_company_commission,3)) THEN RAISE EXCEPTION 'invalid_expected_commission' USING ERRCODE='22023';END IF;
 IF role_name<>'owner' AND p_expected_company_commission IS NOT NULL THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.deals WHERE id=p_deal_id AND company_id=company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found' USING ERRCODE='22023';END IF;
 IF d.reservation_confirmed_at IS NOT NULL THEN
  IF (d.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date=p_payment_date AND d.deposit_amount=p_amount AND
    (p_expected_company_commission IS NULL OR d.expected_company_commission_at_reservation IS NOT DISTINCT FROM p_expected_company_commission) THEN
   RETURN jsonb_build_object('ok',true,'already_confirmed',true,'deal_id',d.id);END IF;
  RAISE EXCEPTION 'reservation_already_confirmed_do_not_overwrite' USING ERRCODE='22023';END IF;
 IF d.stage IN('lost','viewing_cancelled','viewing_no_show') THEN RAISE EXCEPTION 'invalid_deal_stage_for_paid_deposit' USING ERRCODE='22023';END IF;
 UPDATE public.deals SET reservation_confirmed_at=(p_payment_date+time '12:00') AT TIME ZONE 'Asia/Muscat',
  reservation_evidence_note='paid_deposit_confirmed_in_crm',deposit_amount=p_amount,
  expected_company_commission_at_reservation=p_expected_company_commission,
  stage=CASE WHEN d.stage IN('new','viewing_scheduled','viewing_postponed','visit','negotiation') THEN 'deposit' ELSE d.stage END,updated_at=clock_timestamp() WHERE id=p_deal_id;
 RETURN jsonb_build_object('ok',true,'deal_id',p_deal_id,'confirmed_on',p_payment_date);
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.save_deal_milestones(p_deal_id uuid, p_payload jsonb, p_key uuid, p_previous jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.deals%rowtype; b jsonb:=p_payload->'reservation'; f jsonb:=p_payload->'financials'; receipt jsonb:=p_payload->'receipt'; pay_day date; amt numeric; why text; correcting boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT crm_repair_private.can_access_deal_workflow(p_deal_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501';END IF;
 IF receipt IS NOT NULL AND receipt<>'null'::jsonb AND public.my_role()<>'owner' THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.deals WHERE id=p_deal_id FOR UPDATE;
 -- The stage itself confirms payment; a separate checkbox/upload is unnecessary.
 IF d.stage='deposit' AND d.reservation_confirmed_at IS NULL AND coalesce(p_previous->>'stage','')<>'deposit' THEN
  b:=coalesce(nullif(b,'null'::jsonb),'{}'::jsonb)||jsonb_build_object('confirm_paid',true);
 END IF;
 IF b IS NOT NULL AND b<>'null'::jsonb THEN
  SELECT * INTO d FROM public.deals WHERE id=p_deal_id FOR UPDATE;
  correcting:=b ? 'correct_paid_on' OR b ? 'correct_amount' OR coalesce((b->>'reactivate')::boolean,false);
  IF correcting THEN
   why:=nullif(btrim(b->>'correction_reason'),'');
   IF public.my_role()<>'owner' THEN RAISE EXCEPTION 'owner_only_reservation_correction' USING ERRCODE='42501';END IF;
   IF d.reservation_confirmed_at IS NULL OR why IS NULL THEN RAISE EXCEPTION 'confirmed_reservation_and_correction_reason_required' USING ERRCODE='22023';END IF;
   IF coalesce((b->>'reactivate')::boolean,false) AND d.stage='lost' THEN RAISE EXCEPTION 'choose_active_stage_before_reactivation' USING ERRCODE='22023';END IF;
   INSERT INTO crm_repair_private.reservation_change_context VALUES(txid_current(),d.id,auth.uid(),why);
   IF b ? 'correct_amount' AND (nullif(b->>'correct_amount','')::numeric IS NULL OR (b->>'correct_amount')::numeric<=0 OR (b->>'correct_amount')::numeric<>round((b->>'correct_amount')::numeric,3)) THEN RAISE EXCEPTION 'actual_paid_deposit_date_and_amount_required' USING ERRCODE='22023';END IF;
   IF b ? 'correct_paid_on' AND nullif(b->>'correct_paid_on','') IS NULL THEN RAISE EXCEPTION 'actual_paid_deposit_date_and_amount_required' USING ERRCODE='22023';END IF;
   UPDATE public.deals SET
    reservation_confirmed_at=CASE WHEN b ? 'correct_paid_on' THEN ((b->>'correct_paid_on')::date+time '12:00') AT TIME ZONE 'Asia/Muscat' ELSE reservation_confirmed_at END,
    deposit_amount=CASE WHEN b ? 'correct_amount' THEN (b->>'correct_amount')::numeric ELSE deposit_amount END,
    reservation_cancelled_at=CASE WHEN coalesce((b->>'reactivate')::boolean,false) THEN NULL ELSE reservation_cancelled_at END,
    reservation_cancellation_reason=CASE WHEN coalesce((b->>'reactivate')::boolean,false) THEN NULL ELSE reservation_cancellation_reason END,
    updated_at=clock_timestamp() WHERE id=d.id;
   DELETE FROM crm_repair_private.reservation_change_context WHERE transaction_id=txid_current() AND deal_id=d.id;
  END IF;
  IF coalesce((b->>'confirm_paid')::boolean,false) THEN
   PERFORM public.crm_confirm_paid_reservation(p_deal_id,(b->>'paid_on')::date,(b->>'amount')::numeric,(b->>'expected_company_commission')::numeric);
  END IF;
  IF b ? 'reference' THEN UPDATE public.deals SET reservation_reference=nullif(btrim(b->>'reference'),'') WHERE id=p_deal_id;END IF;
  IF b ? 'cancelled_on' AND nullif(b->>'cancelled_on','') IS NOT NULL THEN
   UPDATE public.deals SET reservation_cancelled_at=(b->>'cancelled_on')::date+time '12:00' AT TIME ZONE 'Asia/Muscat',
    reservation_cancellation_reason=nullif(btrim(b->>'cancellation_reason'),''),updated_at=clock_timestamp() WHERE id=p_deal_id;END IF;
 END IF;
 IF f IS NOT NULL AND f<>'null'::jsonb THEN
  IF public.my_role()<>'owner' THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501';END IF;
  IF f ? 'expected_company_commission' THEN UPDATE public.deals SET expected_company_commission_at_reservation=nullif(f->>'expected_company_commission','')::numeric WHERE id=p_deal_id;END IF;
  IF f ? 'entitled_on' THEN UPDATE public.deals SET commission_entitled_at=(nullif(f->>'entitled_on','')::date+time '12:00') AT TIME ZONE 'Asia/Muscat' WHERE id=p_deal_id;END IF;
 END IF;
 IF receipt IS NOT NULL AND receipt<>'null'::jsonb THEN
  SELECT * INTO d FROM public.deals WHERE id=p_deal_id FOR UPDATE;
  pay_day:=nullif(receipt->>'received_on','')::date;amt:=nullif(receipt->>'amount','')::numeric;
  IF pay_day IS NULL OR amt IS NULL OR amt<=0 OR amt IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR amt<>round(amt,3) OR nullif(btrim(receipt->>'source_note'),'') IS NULL OR pay_day>(now() AT TIME ZONE 'Asia/Muscat')::date OR d.closed_at IS NULL OR pay_day<(d.closed_at AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'actual_receipt_date_amount_source_after_sale_required' USING ERRCODE='22023';END IF;
  -- Do not silently replace a legacy receipt with a new ledger or guess its date.
  IF NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_commission_receipts WHERE deal_id=d.id) AND
    (coalesce((p_previous->>'company_commission_received_amount')::numeric,0)>0 OR p_previous->>'commission_status'='received') THEN RAISE EXCEPTION 'legacy_receipt_requires_review_before_ledger' USING ERRCODE='22023';END IF;
  INSERT INTO crm_repair_private.deal_commission_receipts(company_id,deal_id,operation_key,received_on,amount,source_note,actor_id)
  VALUES(d.company_id,d.id,p_key,pay_day,amt,btrim(receipt->>'source_note'),auth.uid());
  UPDATE public.deals SET company_commission_received_amount=(SELECT sum(amount) FROM crm_repair_private.deal_commission_receipts WHERE deal_id=d.id),
   commission_received_at=(SELECT max(received_on)+time '12:00' AT TIME ZONE 'Asia/Muscat' FROM crm_repair_private.deal_commission_receipts WHERE deal_id=d.id),updated_at=clock_timestamp() WHERE id=d.id;
 END IF;
END $function$
;

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
   d.agent_share:=round((coalesce(d.commission_total,0)-coalesce(d.broker_commission,0))*d.employee_commission_percent/100,3);
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
 'company_commission_remaining',greatest(0,coalesce(d.commission_total-coalesce(d.broker_commission,0),d.expected_company_commission_at_reservation,0)-coalesce(d.company_commission_received_amount,CASE WHEN d.commission_status='received' THEN coalesce(d.commission_total-coalesce(d.broker_commission,0),d.company_commission,d.company_share,0) ELSE 0 END)),
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
   coalesce(d.company_commission_received_amount,d.company_commission,d.company_share,0),1
  FROM allowed d WHERE NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_commission_receipts x WHERE x.deal_id=d.id)
   AND d.commission_received_at>=start_at AND d.commission_received_at<end_at
   AND (d.company_commission_received_amount IS NOT NULL OR d.commission_status='received' OR d.stage='commission_collected')
 ) SELECT emp,sum(booked)::bigint,sum(active)::bigint,sum(cancelled)::bigint,sum(expected),sum(unknown_amount)::bigint,sum(collected),sum(receipts)::bigint
 FROM credits WHERE r<>'agent' OR emp=u GROUP BY emp;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_employee_performance(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.my_company(); v_actor uuid:=auth.uid(); v_role text:=public.my_role();
 v_start timestamptz;v_end timestamptz;v_result jsonb;v_inception date;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then
  raise exception using errcode='42501',message='performance_not_allowed';
 end if;
 -- Company row creation is not the beginning of the historical business ledger.
 select least((c.created_at at time zone 'Asia/Muscat')::date,(
   select min((least(hd.closed_at,hd.reservation_confirmed_at) at time zone 'Asia/Muscat')::date)
   from public.deals hd where (crm_repair_private.investment_row_allowed(hd.company_id,to_jsonb(hd)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(hd.company_id,to_jsonb(hd)))) and hd.company_id=c.id and (hd.stage in('closed','commission_collected') or (hd.reservation_confirmed_at is not null and nullif(btrim(hd.reservation_evidence_note),'') is not null and hd.deposit_amount>0))
    and (v_role<>'agent' or (hd.agent_id=v_actor
      and crm_repair_private.can_access_client(hd.company_id,hd.client_id)
      and (hd.property_id is null or exists(select 1 from public.properties hp where (crm_repair_private.investment_row_allowed(hp.company_id,to_jsonb(hp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(hp.company_id,to_jsonb(hp)))) and hp.id=hd.property_id and hp.company_id=hd.company_id and crm_repair_private.staff_can_access_branch(hp.company_id,hp.branch_key)))))
 )) into v_inception from public.companies c where c.id=v_company;
 if p_from is null then p_from:=v_inception;end if;
 if p_from is null or p_to is null or p_to<=p_from then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 -- Materialize period messages and conversation authorization once, not once per
 -- employee/message. This preserves human attribution while bounding dashboard work.
 with outbound_candidates as materialized (
  select m.* from public.whatsapp_messages m
  where m.company_id=v_company and m.direction='outbound' and m.actor_type='human'
   and m.message_timestamp>=v_start and m.message_timestamp<v_end
 ), outbound_conversations as materialized (
  select wc.id,wc.company_id,wc.route_key,wc.client_id from public.whatsapp_conversations wc
  where wc.company_id=v_company and exists(select 1 from outbound_candidates m where m.conversation_id=wc.id)
   and crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(wc.company_id,to_jsonb(wc)))
   and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(wc.company_id,wc.id))
 ), outbound_credit as materialized (
  select mm.id,mm.company_id,mm.conversation_id,mm.client_id,mm.message_timestamp,mm.reply_to_message_id,
   mm.delivery_status,mm.channel_source,mm.raw_payload,wc.id authorized_conversation_id,wc.client_id conversation_client_id,
   crm_repair_private.performance_employee(mm.company_id,wc.route_key,mm.message_timestamp,mm.sent_by_user_id) employee_id
  from outbound_candidates mm left join outbound_conversations wc on wc.id=mm.conversation_id and wc.company_id=mm.company_id
  where crm_repair_private.investment_row_allowed(mm.company_id,to_jsonb(mm))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(mm.company_id,to_jsonb(mm)))
   and (v_role<>'agent' or wc.id is not null)
 ), outbound_counts as (select employee_id,count(*) outbound from outbound_credit group by employee_id),
 -- Successful staff messages are a separate, accurately named volume metric.
 -- Keep legacy outbound_messages unchanged for existing consumers.
 staff_messages as materialized (
  select m.id,m.company_id,m.conversation_id,coalesce(m.client_id,m.conversation_client_id) client_id,
   m.message_timestamp,m.reply_to_message_id,m.employee_id
  from outbound_credit m
  where m.authorized_conversation_id is not null
   and lower(coalesce(m.delivery_status,'')) in ('sent','delivered','read')
   and coalesce(m.channel_source,'') !~* '(autom|greeting|away|bot|crm_followup)'
   and coalesce(m.raw_payload->>'source','') !~* '(autom|(^|_)auto(_|$)|greeting|away|bot|followup_optin)'
   and lower(coalesce(m.raw_payload->>'automated','false')) not in ('true','1')
   and lower(coalesce(m.raw_payload->>'is_automated','false')) not in ('true','1')
   and lower(coalesce(m.raw_payload->>'actor_type','')) <> 'automated'
   and (m.client_id is null or m.client_id=m.conversation_client_id)
   and (v_role<>'agent' or (m.conversation_client_id is null or crm_repair_private.can_access_client(m.company_id,m.conversation_client_id)))
 ), staff_counts as (select employee_id,count(*) successful_staff_messages from staff_messages group by employee_id),
 -- Use each actual inbound timestamp, not property_inquiries.first_inquiry_at.
 -- Returning clients in this period count once, even across several properties,
 -- requests, messages or conversations. A manually created visit is not evidence.
 period_inbound as materialized (
  select m.* from public.whatsapp_messages m
  where m.company_id=v_company and m.direction='inbound'
   and m.message_timestamp>=v_start and m.message_timestamp<v_end
   and exists(select 1 from public.property_message_attributions a where a.company_id=m.company_id and a.message_id=m.id)
 ), inquiry_conversations as materialized (
  select wc.* from public.whatsapp_conversations wc
  where wc.company_id=v_company and exists(select 1 from period_inbound m where m.conversation_id=wc.id)
   and wc.route_key in ('muscat','barka')
   and crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(wc.company_id,to_jsonb(wc)))
   and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(wc.company_id,wc.id))
 ), inquiry_evidence as materialized (
  select distinct m.id message_id,m.whatsapp_message_id,m.client_id,m.conversation_id,m.message_timestamp,
   crm_repair_private.performance_employee(m.company_id,wc.route_key,m.message_timestamp,coalesce(pi.assigned_to,wc.assigned_to)) employee_id
  from period_inbound m
  join inquiry_conversations wc on wc.id=m.conversation_id and wc.company_id=m.company_id and wc.client_id=m.client_id
  join public.property_message_attributions a on a.company_id=m.company_id and a.message_id=m.id and a.client_id=m.client_id
  join public.clients c on c.id=m.client_id and c.company_id=m.company_id
  join public.properties p on p.id=a.property_id and p.company_id=a.company_id and p.branch_key=wc.route_key
  left join public.property_inquiries pi on pi.id=a.inquiry_id and pi.company_id=a.company_id and pi.client_id=a.client_id and pi.property_id=a.property_id
  where crm_repair_private.investment_row_allowed(a.company_id,to_jsonb(a))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(a.company_id,to_jsonb(a)))
   and crm_repair_private.investment_row_allowed(m.company_id,to_jsonb(m))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(m.company_id,to_jsonb(m)))
   and crm_repair_private.investment_row_allowed(c.company_id,to_jsonb(c))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(c.company_id,to_jsonb(c)))
   and crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p)))
   and (pi.id is null or (crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi))
    and not (v_role='owner' and crm_repair_private.investment_link_is_private(pi.company_id,to_jsonb(pi)))))
   and (v_role<>'agent' or (crm_repair_private.can_access_client(c.company_id,c.id)
    and crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))
 ), inquiry_client_counts as (
  select i.employee_id,count(distinct i.client_id) inquiry_clients,
   count(distinct i.client_id) filter(where exists(
    select 1 from staff_messages s where s.employee_id=i.employee_id and s.client_id=i.client_id
     and s.conversation_id=i.conversation_id and s.message_timestamp>=i.message_timestamp
     and (s.reply_to_message_id is null or s.reply_to_message_id=i.whatsapp_message_id or s.reply_to_message_id=i.message_id::text)
   )) replied_inquiry_clients
  from inquiry_evidence i group by i.employee_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(d.with_visit,0),
   'sales',coalesce(d.sales,0),
   'reservations',coalesce(b.reservations,0),'active_reservations',coalesce(b.active_reservations,0),'cancelled_reservations',coalesce(b.cancelled_reservations,0),
   'expected_commission',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(b.expected_commission,0) else null end,
   'unknown_expected_commission',coalesce(b.unknown_expected_commission,0),
   'commission_collected',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(b.commission_collected,0) else null end,'receipt_count',coalesce(b.receipt_count,0),
   'sales_goal_met',((CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.reservations_target END)>0 AND coalesce(b.reservations,0)>=(CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.reservations_target END) OR (CASE WHEN t.employee_id IS NULL THEN 4000 ELSE t.booking_commission_target END)>0 AND coalesce(b.expected_commission,0)>=(CASE WHEN t.employee_id IS NULL THEN 4000 ELSE t.booking_commission_target END)),
   'company_commission',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),
   'outbound_messages',coalesce(w.outbound,0),
   'inquiry_clients',coalesce(ic.inquiry_clients,0),
   'replied_inquiry_clients',coalesce(ic.replied_inquiry_clients,0),
   'successful_staff_messages',coalesce(sc.successful_staff_messages,0),
   'targets',jsonb_build_object('inventory_target',10,'reservations_target',2,'booking_commission_target',4000)||coalesce(to_jsonb(t)-'company_id'-'employee_id'-'month_start'-'updated_at','{}'::jsonb)
 )),'[]'::jsonb) into v_result
 from public.profiles e
 left join crm_repair_private.deal_period_metrics(p_from,p_to) b on b.employee_id=e.id
 left join public.employee_monthly_targets t on t.company_id=e.company_id and t.employee_id=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   select count(*) filter(where p.archived=false and p.status not in('sold','not_available')) active_inventory,
    count(*) filter(where p.created_at>=v_start and p.created_at<v_end) new_properties
   from public.properties p where (crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p)))) and p.company_id=e.company_id and crm_repair_private.performance_employee(p.company_id,p.branch_key,p.created_at,p.sourced_by)=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where (crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(vv.company_id,to_jsonb(vv)))) and vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where (crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pi.company_id,to_jsonb(pi)))) and pi.company_id=e.company_id and crm_repair_private.performance_employee(pi.company_id,(select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=pi.property_id and pp.company_id=pi.company_id),pi.first_inquiry_at,pi.assigned_to)=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done
   from public.viewings vv where (crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(vv.company_id,to_jsonb(vv)))) and vv.company_id=e.company_id and crm_repair_private.performance_employee(vv.company_id,(select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=vv.property_id and pp.company_id=vv.company_id),vv.created_at,vv.agent_id)=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   -- A sale belongs to its actual closing period. Count it once when a real
   -- completed visit for the same client/property occurred no later than closing,
   -- including visits from earlier periods. Unknown/historical visits stay unknown.
   select count(*) sales,
    count(*) filter(where exists(
      select 1 from public.viewings sv
      where sv.company_id=dd.company_id and sv.client_id=dd.client_id and sv.property_id=dd.property_id
       and sv.archived=false and sv.status='done'
       and sv.viewing_date<=(dd.closed_at at time zone 'Asia/Muscat')::date
       and (crm_repair_private.investment_row_allowed(sv.company_id,to_jsonb(sv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(sv.company_id,to_jsonb(sv))))
       and (v_role<>'agent' or (crm_repair_private.can_access_client(sv.company_id,sv.client_id)
        and exists(select 1 from public.properties sp where sp.id=sv.property_id and sp.company_id=sv.company_id
         and (crm_repair_private.investment_row_allowed(sp.company_id,to_jsonb(sp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(sp.company_id,to_jsonb(sp))))
         and crm_repair_private.staff_can_access_branch(sp.company_id,sp.branch_key))))
    )) with_visit,
    sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where (crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(dd.company_id,to_jsonb(dd)))) and dd.company_id=e.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where (crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(cc.company_id,to_jsonb(cc)))) and cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where (crm_repair_private.investment_row_allowed(aa.company_id,to_jsonb(aa)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(aa.company_id,to_jsonb(aa)))) and aa.company_id=e.company_id and crm_repair_private.performance_employee(aa.company_id,coalesce((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where (crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(cc.company_id,to_jsonb(cc)))) and cc.id=aa.client_id and cc.company_id=aa.company_id)),coalesce(aa.occurred_at,aa.created_at),aa.user_id)=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join outbound_counts w on w.employee_id=e.id
 left join inquiry_client_counts ic on ic.employee_id=e.id
 left join staff_counts sc on sc.employee_id=e.id
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$
;


CREATE OR REPLACE FUNCTION public.crm_save_deal_workflow(p_payload jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text;n numeric;f jsonb:=p_payload#>'{deal,financials}';
BEGIN
 FOREACH k IN ARRAY ARRAY['commission_total','broker_commission','agent_share','expected_company_commission'] LOOP
  n:=nullif(f->>k,'')::numeric;
  IF n IS NOT NULL AND (n<0 OR n IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR n<>round(n,3)) THEN RAISE EXCEPTION 'invalid_omr_amount' USING ERRCODE='22023';END IF;
 END LOOP;
 RETURN crm_repair_private.save_deal_workflow(p_payload,p_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.crm_save_deal_workflow(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_save_deal_workflow(jsonb,uuid) TO authenticated;

-- Checking the final transaction state prevents raw API stage updates from
-- bypassing confirmation, while the atomic workflow may fill it in one call.
CREATE OR REPLACE FUNCTION crm_repair_private.require_deposit_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.stage='deposit' AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM 'deposit') AND EXISTS(
  SELECT 1 FROM public.deals WHERE id=NEW.id AND stage='deposit' AND (reservation_confirmed_at IS NULL OR deposit_amount IS NULL OR deposit_amount<=0 OR nullif(btrim(reservation_evidence_note),'') IS NULL)) THEN
  RAISE EXCEPTION 'paid_deposit_date_amount_required_for_reservation' USING ERRCODE='22023';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.require_deposit_reservation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS crm_require_deposit_reservation ON public.deals;
CREATE CONSTRAINT TRIGGER crm_require_deposit_reservation AFTER INSERT OR UPDATE ON public.deals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_repair_private.require_deposit_reservation();

CREATE OR REPLACE FUNCTION public.crm_log_human_activity(p_payload jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.activities%rowtype;u uuid:=auth.uid();c uuid:=public.my_company();cid uuid:=(p_payload->>'client_id')::uuid;
 t text:=p_payload->>'type';txt text:=nullif(btrim(p_payload->>'description'),'');result_text text:=nullif(btrim(p_payload->>'outcome'),'');ph text:=md5(p_payload::text);
BEGIN
 IF u IS NULL OR c IS NULL OR coalesce(public.my_role(),'') NOT IN ('owner','manager','agent') OR NOT crm_repair_private.can_access_client(c,cid) THEN RAISE EXCEPTION 'activity_not_allowed' USING ERRCODE='42501';END IF;
 IF p_idempotency_key IS NULL OR txt IS NULL OR t NOT IN ('note','call','whatsapp','meeting','visit','email','followup','contact') OR (t IN ('call','whatsapp','meeting','email','followup','contact') AND result_text IS NULL) THEN RAISE EXCEPTION 'activity_description_and_contact_outcome_required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':activity:'||p_idempotency_key::text,0));
 SELECT * INTO a FROM public.activities WHERE id=p_idempotency_key;
 IF FOUND THEN
  IF a.user_id<>u OR a.company_id<>c OR a.after_data->>'operation_hash' IS DISTINCT FROM ph THEN RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('ok',true,'activity_id',a.id,'replayed',true);
 END IF;
 INSERT INTO public.activities(id,company_id,user_id,client_id,type,description,actor_type,outcome,next_action,occurred_at,after_data)
 VALUES(p_idempotency_key,c,u,cid,t,txt,'human',result_text,nullif(btrim(p_payload->>'next_action'),''),clock_timestamp(),jsonb_build_object('operation_hash',ph)) RETURNING id INTO a.id;
 IF t IN ('call','whatsapp','meeting','email','followup','contact') THEN UPDATE public.clients SET last_contact_at=clock_timestamp() WHERE id=cid AND company_id=c;END IF;
 IF nullif(p_payload->>'next_followup','') IS NOT NULL THEN UPDATE public.clients SET next_followup=(p_payload->>'next_followup')::date WHERE id=cid AND company_id=c;END IF;
 RETURN jsonb_build_object('ok',true,'activity_id',a.id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.crm_log_human_activity(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_log_human_activity(jsonb,uuid) TO authenticated;



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
  (SELECT count(DISTINCT p.id) FROM public.properties p WHERE p.company_id=c AND p.branch_key=e.branch AND p.status='available' AND NOT coalesce(p.archived,false) AND p.price>0 AND p.availability_checked_at IS NOT NULL AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date BETWEEN wk AND today AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))) additions,
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



-- Trigger-only routines never need RPC execution privileges. Trigger invocation
-- continues unchanged, including service-role webhooks.
REVOKE ALL ON FUNCTION public.crm_set_request_geography(),public.crm_sync_request_assignees(),
 public.exclude_internal_numbers_from_followups(),public.process_followup_reply_from_whatsapp(),
 public.sync_followup_delivery_status(),public.sync_property_monitoring_from_marketing_event() FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS activity_human_followup_day ON public.activities(company_id,occurred_at,client_id) WHERE actor_type='human' AND outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS milestone_events_deal_recorded ON crm_repair_private.deal_milestone_events(deal_id,recorded_at);
UPDATE crm_repair_private.audit25_catalog_backup b SET applied_definition=pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.oid::regprocedure::text=b.identity;
NOTIFY pgrst,'reload schema';
