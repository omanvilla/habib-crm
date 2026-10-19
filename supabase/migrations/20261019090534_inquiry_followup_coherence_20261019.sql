-- SQL29: one acknowledged manual follow-up transaction, using actual new
-- outcome evidence. Existing inquiry dates and historical notes are not backfilled.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit29_catalog_backup(
 identity text PRIMARY KEY, definition text, applied_definition text
);
ALTER TABLE crm_repair_private.audit29_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit29_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.audit29_catalog_backup(identity,definition)
SELECT identity,CASE WHEN to_regprocedure(identity) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(identity)) END
FROM (VALUES ('public.crm_save_inquiry_followup(jsonb,uuid)'),('public.sync_request_from_property_inquiry()')) f(identity)
ON CONFLICT DO NOTHING;
DO $$ DECLARE b record; BEGIN
 FOR b IN SELECT * FROM crm_repair_private.audit29_catalog_backup LOOP
  IF b.applied_definition IS NOT NULL
   AND (CASE WHEN to_regprocedure(b.identity) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(b.identity)) END) IS DISTINCT FROM b.definition
   AND (CASE WHEN to_regprocedure(b.identity) IS NOT NULL THEN pg_get_functiondef(to_regprocedure(b.identity)) END) IS DISTINCT FROM b.applied_definition THEN
   RAISE EXCEPTION 'SQL29 apply refused: function changed since release: %',b.identity;
  END IF;
 END LOOP;
END $$;

-- A follow-up on a historical negotiation does not establish its unknown
-- original negotiation date. Milestones arise only from their actual transition.
CREATE OR REPLACE FUNCTION public.sync_request_from_property_inquiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_at timestamptz:=coalesce(NEW.last_contact_at,NEW.updated_at,NEW.last_inquiry_at,now());
 v_match boolean;v_interest boolean;v_opportunity boolean;v_negotiation boolean;
BEGIN
 IF NEW.request_id IS NULL THEN RETURN NEW; END IF;
 v_match:=NEW.shown_by_agent AND NEW.match_status='matched';
 v_interest:=lower(coalesce(NEW.post_visit_interest,'')) IN ('serious','high');
 v_opportunity:=NEW.status IN ('negotiation','reserved','deal');
 v_negotiation:=NEW.status='negotiation';
 IF TG_OP='UPDATE' THEN
  -- This update is the newly recorded transition. A prior contact timestamp
  -- cannot be reused as its business date when the new outcome is blank.
  v_at:=clock_timestamp();
  v_match:=v_match AND NOT (coalesce(OLD.shown_by_agent,false) AND OLD.match_status IS NOT DISTINCT FROM 'matched');
  v_interest:=v_interest AND lower(coalesce(OLD.post_visit_interest,'')) NOT IN ('serious','high');
  v_opportunity:=v_opportunity AND OLD.status NOT IN ('negotiation','reserved','deal');
  v_negotiation:=v_negotiation AND OLD.status IS DISTINCT FROM 'negotiation';
 END IF;
 IF NOT coalesce(v_match OR v_interest OR v_opportunity OR v_negotiation,false) THEN RETURN NEW; END IF;
 UPDATE public.client_requests r SET
  first_match_sent_at=CASE WHEN v_match AND r.first_match_sent_at IS NULL THEN v_at ELSE r.first_match_sent_at END,
  serious_interest_at=CASE WHEN v_interest AND r.serious_interest_at IS NULL THEN v_at ELSE r.serious_interest_at END,
  opportunity_opened_at=CASE WHEN v_opportunity AND r.opportunity_opened_at IS NULL THEN v_at ELSE r.opportunity_opened_at END,
  negotiation_started_at=CASE WHEN v_negotiation AND r.negotiation_started_at IS NULL THEN v_at ELSE r.negotiation_started_at END,
  updated_at=now()
 WHERE r.id=NEW.request_id AND r.company_id=NEW.company_id AND r.client_id=NEW.client_id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.crm_save_inquiry_followup(p_payload jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 c uuid:=public.my_company();u uuid:=auth.uid();r text:=public.my_role();
 q public.property_inquiries%rowtype;saved public.property_inquiries%rowtype;a public.activities%rowtype;
 rq public.client_requests%rowtype;
 qid uuid;st text;note text;action text;nf date;reason_id uuid;phase text;
 expected_at timestamptz;event_at timestamptz;ph text;
 private_link boolean;activity_text text;reason_result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR coalesce(r,'') NOT IN ('owner','manager','agent') THEN
  RAISE EXCEPTION 'inquiry_followup_not_allowed' USING ERRCODE='42501';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_idempotency_key IS NULL THEN
  RAISE EXCEPTION 'inquiry_followup_payload_required' USING ERRCODE='22023';
 END IF;
 qid:=nullif(p_payload->>'inquiry_id','')::uuid;st:=p_payload->>'status';
 note:=nullif(btrim(p_payload->>'outcome'),'');action:=nullif(btrim(p_payload->>'next_action'),'');
 nf:=nullif(p_payload->>'next_followup','')::date;
 reason_id:=nullif(p_payload->>'reason_id','')::uuid;phase:=coalesce(nullif(p_payload->>'reason_phase',''),'unknown');
 expected_at:=nullif(p_payload->>'expected_updated_at','')::timestamptz;
 IF qid IS NULL OR st IS NULL OR st NOT IN ('inquiry','followup','viewing_scheduled','viewed','negotiation','reserved','deal','not_suitable','no_response','closed')
  OR (st='followup' AND nf IS NULL) OR (st='not_suitable' AND reason_id IS NULL)
  OR phase NOT IN ('unknown','pre_visit','post_visit') OR length(coalesce(note,''))>10000 OR length(coalesce(action,''))>2000 THEN
  RAISE EXCEPTION 'inquiry_followup_invalid_fields' USING ERRCODE='22023';
 END IF;
 ph:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':inquiry-followup:'||p_idempotency_key::text,0));
 SELECT * INTO q FROM public.property_inquiries WHERE id=qid AND company_id=c FOR UPDATE;
 IF NOT FOUND OR NOT crm_repair_private.can_access_client(c,q.client_id)
  OR (q.request_id IS NOT NULL AND NOT crm_repair_private.can_access_request(c,q.request_id))
  OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=q.property_id AND p.company_id=c
   AND crm_repair_private.staff_can_access_branch(c,p.branch_key))
  OR (r='agent' AND q.assigned_to IS DISTINCT FROM u) THEN
  RAISE EXCEPTION 'inquiry_followup_not_allowed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM public.activities WHERE id=p_idempotency_key;
 IF FOUND THEN
  IF a.company_id IS DISTINCT FROM c OR a.user_id IS DISTINCT FROM u OR a.after_data->>'operation_hash' IS DISTINCT FROM ph
   OR a.after_data->>'operation_type' IS DISTINCT FROM 'inquiry_followup' THEN
   RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('ok',true,'inquiry_id',q.id,'activity_id',a.id,'contact_recorded',a.outcome IS NOT NULL,'inquiry',to_jsonb(q),'replayed',true);
 END IF;
 IF expected_at IS NULL OR q.updated_at IS DISTINCT FROM expected_at THEN
  RAISE EXCEPTION 'inquiry_changed_reload_before_saving' USING ERRCODE='40001';
 END IF;
 IF q.request_id IS NOT NULL THEN
  SELECT * INTO rq FROM public.client_requests WHERE id=q.request_id AND company_id=c AND client_id=q.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_request_not_allowed' USING ERRCODE='42501'; END IF;
 END IF;
 -- Serialize follow-ups for different inquiries belonging to the same client.
 -- Capture the event clock only after inquiry, request and client locks so a
 -- waiting save cannot overwrite the client's newer actual contact time.
 PERFORM 1 FROM public.clients WHERE id=q.client_id AND company_id=c FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_client_update_not_allowed' USING ERRCODE='42501'; END IF;
 event_at:=clock_timestamp();
 -- A label cannot manufacture a visit or a paid booking. Use the existing
 -- authoritative forms for those transitions and then record their follow-up.
 IF st IS DISTINCT FROM q.status THEN
  IF st IN ('viewing_scheduled','viewed') AND NOT EXISTS(
   SELECT 1 FROM public.viewings v WHERE v.company_id=c AND v.client_id=q.client_id AND v.property_id=q.property_id
    AND v.request_id IS NOT DISTINCT FROM q.request_id AND NOT coalesce(v.archived,false)
    AND ((st='viewed' AND v.status='done') OR (st='viewing_scheduled' AND v.status IN ('scheduled','confirmed')))
  ) THEN RAISE EXCEPTION 'inquiry_requires_actual_viewing' USING ERRCODE='22023'; END IF;
  IF st='reserved' AND NOT EXISTS(
   SELECT 1 FROM public.crm_deals_access d WHERE d.company_id=c AND d.client_id=q.client_id AND d.property_id=q.property_id
    AND d.request_id IS NOT DISTINCT FROM q.request_id AND d.reservation_confirmed_at IS NOT NULL
    AND d.deposit_amount>0 AND d.reservation_cancelled_at IS NULL AND d.stage<>'lost'
  ) THEN RAISE EXCEPTION 'inquiry_requires_paid_reservation_workflow' USING ERRCODE='22023'; END IF;
  IF st IN ('negotiation','deal') AND NOT EXISTS(
   SELECT 1 FROM public.crm_deals_access d WHERE d.company_id=c AND d.client_id=q.client_id AND d.property_id=q.property_id
    AND d.request_id IS NOT DISTINCT FROM q.request_id AND d.stage IN ('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected')
  ) THEN RAISE EXCEPTION 'inquiry_requires_deal_workflow' USING ERRCODE='22023'; END IF;
 END IF;
 -- The recursive private-link helper is deliberately not executable by login
 -- roles. Non-owner RLS has already excluded private rows; the owner uses the
 -- existing boolean-only classification API without exposing or broadening it.
 private_link:=CASE WHEN r='owner' THEN NOT coalesce((public.crm_shared_ai_evidence_mask(
  jsonb_build_array(jsonb_build_object('table','property_inquiries','id',q.id))))[1],false) ELSE false END;
 -- Do not move actual inbound first/last dates when an employee follows up.
 -- A blank new outcome is administrative only; preserve the previous note.
 UPDATE public.property_inquiries SET status=st,next_followup=nf,
  followup_note=coalesce(note,followup_note),
  last_contact_at=CASE WHEN note IS NOT NULL THEN event_at ELSE last_contact_at END
 WHERE id=q.id AND company_id=c;
 IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_update_not_allowed' USING ERRCODE='42501'; END IF;
 IF st='not_suitable' THEN
  reason_result:=public.crm_replace_rejection_reasons(q.id,ARRAY[reason_id],reason_id,phase,coalesce(note,q.rejection_notes));
 ELSE
  reason_result:=public.crm_replace_rejection_reasons(q.id,'{}'::uuid[],NULL,'unknown',NULL);
 END IF;
 IF coalesce((reason_result->>'ok')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'inquiry_followup_reasons_not_saved' USING ERRCODE='22023';
 END IF;
 IF q.request_id IS NOT NULL AND rq.status IN ('active','paused') THEN
  UPDATE public.client_requests SET next_followup=nf,
   followup_note=coalesce(note,followup_note),next_action=coalesce(action,next_action),
   last_contact_at=CASE WHEN note IS NOT NULL THEN event_at ELSE last_contact_at END,
   updated_by=u,updated_at=now()
  WHERE id=q.request_id AND company_id=c AND client_id=q.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_request_update_not_allowed' USING ERRCODE='42501'; END IF;
 END IF;
 -- A private investment request may share an ordinary branch identity. Its
 -- contact dates and notes must never leak into that branch client's summary.
 IF NOT private_link OR EXISTS(SELECT 1 FROM public.clients cl WHERE cl.id=q.client_id AND cl.company_id=c AND cl.lead_route='investment') THEN
  IF note IS NOT NULL THEN
   UPDATE public.clients SET last_contact_at=event_at,human_contact_at=event_at
   WHERE id=q.client_id AND company_id=c;
   IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_client_update_not_allowed' USING ERRCODE='42501'; END IF;
  END IF;
  IF q.request_id IS NULL THEN
   UPDATE public.clients SET next_followup=nf WHERE id=q.client_id AND company_id=c;
   IF NOT FOUND THEN RAISE EXCEPTION 'inquiry_followup_client_update_not_allowed' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 SELECT * INTO saved FROM public.property_inquiries WHERE id=q.id AND company_id=c;
 activity_text:=CASE WHEN note IS NOT NULL THEN 'نتيجة متابعة العقار: '||note ELSE 'تحديث حالة أو موعد متابعة العقار' END;
 INSERT INTO public.activities(id,company_id,user_id,client_id,property_id,request_id,type,description,activity_type,activity_text,
  actor_type,channel,direction,occurred_at,outcome,next_action,before_data,after_data)
 VALUES(p_idempotency_key,c,u,q.client_id,q.property_id,q.request_id,
  CASE WHEN note IS NOT NULL THEN 'followup' ELSE 'system' END,activity_text,
  CASE WHEN note IS NOT NULL THEN 'followup' ELSE 'system' END,activity_text,'human',
  CASE WHEN note IS NOT NULL THEN 'manual' ELSE 'system' END,'internal',event_at,note,action,
  jsonb_build_object('inquiry',to_jsonb(q),'request',CASE WHEN q.request_id IS NOT NULL THEN to_jsonb(rq) END),
  jsonb_build_object('operation_type','inquiry_followup','operation_hash',ph,'inquiry_id',q.id,'inquiry',to_jsonb(saved),'next_followup',nf));
 RETURN jsonb_build_object('ok',true,'inquiry_id',saved.id,'activity_id',p_idempotency_key,'contact_recorded',note IS NOT NULL,'inquiry',to_jsonb(saved),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.crm_save_inquiry_followup(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_save_inquiry_followup(jsonb,uuid) TO authenticated;
UPDATE crm_repair_private.audit29_catalog_backup SET applied_definition=pg_get_functiondef(to_regprocedure(identity));
NOTIFY pgrst,'reload schema';
