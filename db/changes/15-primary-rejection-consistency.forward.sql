-- Prepared review change; follows 13 and 14. No historic reason is invented or deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Preserve the visit form's explicit general dislike option without inventing a specific cause.
INSERT INTO public.rejection_reasons(company_id,code,label_ar)
SELECT id,'not_interested','لم يعجبه العقار' FROM public.companies
ON CONFLICT(company_id,code) DO NOTHING;

-- Editing customer words/reasons is an audit event, not another sales-stage transition.
CREATE TABLE crm_repair_private.rejection_change_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 source_table text NOT NULL, source_id uuid NOT NULL, client_id uuid NOT NULL,
 property_id uuid NOT NULL, request_id uuid, before_data jsonb, after_data jsonb,
 changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE crm_repair_private.rejection_change_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.rejection_change_audit FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_repair_private.audit_rejection_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_value jsonb; after_value jsonb;
BEGIN
 IF TG_TABLE_NAME='deals' THEN
  IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('reason_id',OLD.lost_reason_id,'note',OLD.lost_reason_note); END IF;
  after_value:=jsonb_build_object('reason_id',NEW.lost_reason_id,'note',NEW.lost_reason_note);
 ELSE
  IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('reason_id',OLD.reason_id,'note',OLD.note,'is_primary',OLD.is_primary); END IF;
  after_value:=jsonb_build_object('reason_id',NEW.reason_id,'note',NEW.note,'is_primary',NEW.is_primary);
 END IF;
 IF before_value IS DISTINCT FROM after_value AND NEW.client_id IS NOT NULL AND NEW.property_id IS NOT NULL THEN
  INSERT INTO crm_repair_private.rejection_change_audit(company_id,source_table,source_id,client_id,property_id,request_id,before_data,after_data,changed_by)
  VALUES(NEW.company_id,TG_TABLE_NAME,NEW.id,NEW.client_id,NEW.property_id,NEW.request_id,before_value,after_value,auth.uid());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.audit_rejection_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_audit_deal_rejection AFTER UPDATE OF lost_reason_id,lost_reason_note ON public.deals
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.audit_rejection_change();
CREATE TRIGGER crm_audit_structured_rejection AFTER UPDATE OF note,is_primary ON public.property_rejection_reasons
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.audit_rejection_change();

-- Internal-only helper. Caller triggers provide a genuine stored journey; checks also defend against bad references.
CREATE FUNCTION crm_repair_private.set_primary_rejection(
 p_company uuid,p_client uuid,p_property uuid,p_request uuid,p_inquiry uuid,
 p_reason uuid,p_note text,p_phase text,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client AND company_id=p_company)
 OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property AND company_id=p_company)
 OR (p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.client_requests WHERE id=p_request AND company_id=p_company AND client_id=p_client))
 OR NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=p_reason AND (company_id=p_company OR company_id IS NULL))
 OR (p_inquiry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_inquiries WHERE id=p_inquiry AND company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request))
 THEN RAISE EXCEPTION 'rejection_references_not_allowed' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NOT NULL AND (public.my_company() IS DISTINCT FROM p_company OR coalesce(public.my_role(),'') NOT IN('owner','manager','agent')
 OR NOT crm_repair_private.can_access_client(p_company,p_client)
 OR (p_request IS NOT NULL AND NOT crm_repair_private.can_access_request(p_company,p_request))
 OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property AND p.company_id=p_company AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))
 THEN RAISE EXCEPTION 'rejection_journey_not_allowed' USING ERRCODE='42501'; END IF;
 IF p_phase NOT IN('pre_visit','post_visit','unknown') THEN RAISE EXCEPTION 'invalid_rejection_phase' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company::text||':rejection:'||p_client::text||':'||p_property::text||':'||coalesce(p_request::text,'legacy'),0));
 SELECT id INTO existing_id FROM public.property_rejection_reasons
 WHERE company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request AND reason_id=p_reason
 ORDER BY is_primary DESC,created_at DESC,id LIMIT 1 FOR UPDATE;
 UPDATE public.property_rejection_reasons SET is_primary=false
 WHERE company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request
 AND is_primary AND id IS DISTINCT FROM existing_id;
 IF existing_id IS NOT NULL THEN
  UPDATE public.property_rejection_reasons SET is_primary=true,phase=p_phase,note=nullif(btrim(p_note),'') WHERE id=existing_id;
 ELSE
  INSERT INTO public.property_rejection_reasons(company_id,property_inquiry_id,client_id,request_id,property_id,reason_id,is_primary,phase,note,created_by)
  VALUES(p_company,p_inquiry,p_client,p_request,p_property,p_reason,true,p_phase,nullif(btrim(p_note),''),p_actor);
 END IF;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.set_primary_rejection(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_repair_private.sync_deal_primary_rejection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inquiry_id uuid; reason_code text; had_visit boolean;
BEGIN
 IF NEW.stage<>'lost' OR NEW.lost_reason_id IS NULL OR NEW.client_id IS NULL OR NEW.property_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage AND NEW.lost_reason_id IS NOT DISTINCT FROM OLD.lost_reason_id
 AND NEW.lost_reason_note IS NOT DISTINCT FROM OLD.lost_reason_note AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id THEN RETURN NEW; END IF;
 SELECT code INTO reason_code FROM public.rejection_reasons WHERE id=NEW.lost_reason_id AND (company_id=NEW.company_id OR company_id IS NULL)
 AND (is_active IS TRUE OR (TG_OP='UPDATE' AND OLD.stage='lost' AND OLD.lost_reason_id=NEW.lost_reason_id));
 IF reason_code IS NULL THEN RAISE EXCEPTION 'rejection_reason_not_allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':rejection:'||NEW.client_id::text||':'||NEW.property_id::text||':'||coalesce(NEW.request_id::text,'legacy'),0));
 SELECT id INTO inquiry_id FROM public.property_inquiries WHERE company_id=NEW.company_id AND client_id=NEW.client_id
 AND property_id=NEW.property_id AND request_id IS NOT DISTINCT FROM NEW.request_id FOR UPDATE;
 had_visit:=EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=NEW.viewing_id AND v.company_id=NEW.company_id
 AND v.client_id=NEW.client_id AND v.property_id=NEW.property_id AND v.request_id IS NOT DISTINCT FROM NEW.request_id AND v.status='done' AND coalesce(v.archived,false)=false);
 IF inquiry_id IS NULL THEN
  INSERT INTO public.property_inquiries(company_id,client_id,property_id,request_id,assigned_to,source,source_detail,status,
   created_by,has_inbound_inquiry,viewing_booked,viewing_completed,outcome,rejection_reason,rejection_notes)
  VALUES(NEW.company_id,NEW.client_id,NEW.property_id,NEW.request_id,NEW.agent_id,'other','اهتمام مرتبط بصفقة CRM','not_suitable',
   auth.uid(),false,had_visit,had_visit,'rejected',reason_code,nullif(btrim(NEW.lost_reason_note),'')) RETURNING id INTO inquiry_id;
 ELSE
  UPDATE public.property_inquiries SET status='not_suitable',outcome='rejected',rejection_reason=reason_code,
   rejection_notes=nullif(btrim(NEW.lost_reason_note),''),updated_at=now() WHERE id=inquiry_id;
 END IF;
 PERFORM crm_repair_private.set_primary_rejection(NEW.company_id,NEW.client_id,NEW.property_id,NEW.request_id,inquiry_id,
  NEW.lost_reason_id,NEW.lost_reason_note,CASE WHEN had_visit THEN 'post_visit' ELSE 'unknown' END,auth.uid());
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_deal_primary_rejection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_sync_deal_primary_rejection AFTER INSERT OR UPDATE OF stage,lost_reason_id,lost_reason_note,request_id ON public.deals
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.sync_deal_primary_rejection();

CREATE OR REPLACE FUNCTION public.record_deal_stage_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage THEN
  INSERT INTO public.deal_stage_history(company_id,deal_id,client_id,property_id,from_stage,to_stage,reason_id,note,changed_by,changed_at)
  VALUES(NEW.company_id,NEW.id,NEW.client_id,NEW.property_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.stage END,
   NEW.stage,NEW.lost_reason_id,CASE WHEN NEW.stage='lost' THEN nullif(btrim(NEW.lost_reason_note),'') END,auth.uid(),now());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_deal_stage_history() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request_id uuid;
  v_inquiry_id uuid;
  v_deal_id uuid;
  v_current_stage text;
  v_target_stage text;
  v_price numeric;
  v_reason_code text;
  v_reason_id uuid;
  v_inquiry_status text;
  v_final boolean;
  v_candidate_count integer;
  v_workflow_context boolean:=false;
begin
  if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;

  v_request_id:=new.request_id;
  if v_request_id is null then
    select count(distinct pi.request_id), min(pi.request_id::text)::uuid into v_candidate_count,v_request_id
    from public.property_inquiries pi
    where pi.company_id=new.company_id and pi.client_id=new.client_id
      and pi.property_id=new.property_id and pi.request_id is not null;
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if v_request_id is null then
    select count(*),min(cr.id::text)::uuid into v_candidate_count,v_request_id
    from public.client_requests cr
    where cr.company_id=new.company_id and cr.client_id=new.client_id and cr.status='active';
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if new.request_id is null and v_request_id is not null then
    update public.viewings set request_id=v_request_id where id=new.id and request_id is null;
  end if;

  if new.status='done' then
    if new.pipeline_outcome='lost' or (new.pipeline_outcome is null and new.client_feedback='disliked') then
      v_target_stage:='lost'; v_inquiry_status:='not_suitable';
    elsif new.pipeline_outcome='negotiation' or (new.pipeline_outcome is null and new.client_feedback='wants_negotiate') then
      v_target_stage:='negotiation'; v_inquiry_status:='negotiation';
    else
      v_target_stage:='visit'; v_inquiry_status:='viewed';
    end if;
  elsif new.status='postponed' then
    v_target_stage:='viewing_postponed'; v_inquiry_status:='followup';
  elsif new.status='no_show' then
    v_target_stage:='viewing_no_show'; v_inquiry_status:='followup';
  elsif new.status='cancelled' then
    v_target_stage:='viewing_cancelled'; v_inquiry_status:='followup';
  else
    v_target_stage:='viewing_scheduled'; v_inquiry_status:='viewing_scheduled';
  end if;

  select pi.id into v_inquiry_id
  from public.property_inquiries pi
  where pi.company_id=new.company_id and pi.client_id=new.client_id and pi.property_id=new.property_id
    and pi.request_id IS NOT DISTINCT FROM v_request_id
  order by case when pi.request_id=v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
  limit 1;

  if v_inquiry_id is null and new.status<>'cancelled' then
    insert into public.property_inquiries(
      company_id,client_id,property_id,assigned_to,source,source_detail,status,
      first_inquiry_at,last_inquiry_at,inquiry_count,created_by,request_id,
      shown_by_agent,match_status,viewing_booked,viewing_completed,post_visit_interest,outcome,
      rejection_reason,rejection_notes,last_contact_at,followup_note,next_followup,has_inbound_inquiry
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,'other','زيارة/معاينة مسجلة في CRM',v_inquiry_status,
      coalesce(new.created_at,now()),now(),1,new.created_by,v_request_id,
      true,'matched',true,(new.status='done'),new.client_feedback,
      case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else null end,
      new.rejection_reason,nullif(btrim(new.outcome_note),''),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  elsif v_inquiry_id is not null then
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=exists(select 1 from public.viewings vx where vx.company_id=new.company_id and vx.client_id=new.client_id and vx.property_id=new.property_id and vx.archived=false and vx.status='done' and vx.request_id IS NOT DISTINCT FROM v_request_id),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') else rejection_notes end,
      last_contact_at=now(),
      followup_note=coalesce(new.next_step,followup_note),
      next_followup=coalesce(new.followup_date,next_followup),
      updated_at=now()
    where id=v_inquiry_id;
  end if;

  v_reason_code:=case coalesce(new.rejection_reason,'')
    when 'price' then 'price_value_mismatch'
    when 'location' then 'location'
    when 'area' then 'built_size'
    when 'room_layout' then 'layout'
    when 'design' then 'layout'
    when 'finishing' then 'finishing'
    when 'parking' then 'yard_parking'
    when 'financing' then 'finance_not_ready'
    when 'found_other' then 'chose_other_property'
    when 'no_response' then 'no_response_after_visit'
    when 'not_serious' then 'client_not_ready'
    when 'not_interested' then 'not_interested'
    when 'other' then 'no_clear_reason'
    when 'no_clear_reason' then 'no_clear_reason'
    else null end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and company_id=new.company_id and is_active=true;

  if v_target_stage='lost' and v_reason_id is not null then
    perform crm_repair_private.set_primary_rejection(
      new.company_id,new.client_id,new.property_id,v_request_id,v_inquiry_id,
      v_reason_id,new.outcome_note,'post_visit',new.created_by);
  end if;

  -- Only the already-authorized atomic deal save can populate this private transaction context.
  -- It preserves an existing card's identity while a new real visit resolves its previously missing request.
  select d.id,d.stage into v_deal_id,v_current_stage
  from crm_repair_private.deal_workflow_context ctx
  join public.deals d on d.id=ctx.deal_id and d.company_id=ctx.company_id
   and d.client_id=ctx.client_id and d.property_id=ctx.property_id
  where ctx.transaction_id=txid_current() and ctx.user_id=auth.uid()
   and ctx.company_id=new.company_id and ctx.client_id=new.client_id and ctx.property_id=new.property_id;
  v_workflow_context:=v_deal_id is not null;
  if not v_workflow_context then
  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and d.request_id IS NOT DISTINCT FROM v_request_id
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  end if;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=nullif(btrim(new.outcome_note),''),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=null,lost_reason_note=null,lost_from_stage=null,lost_at=null,closed_at=null,updated_at=now()
        where id=v_deal_id;
      else
        update public.deals set
          stage=case
            when v_target_stage='negotiation' then 'negotiation'
            when v_target_stage='visit' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit') then 'visit'
            when v_target_stage='viewing_postponed' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_postponed'
            when v_target_stage='viewing_no_show' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_no_show'
            when v_target_stage='viewing_cancelled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_cancelled'
            when v_target_stage='viewing_scheduled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_scheduled'
            else v_current_stage end,
          viewing_id=new.id,
          request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION public.sync_viewing_to_crm() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_repair_private.replace_primary_rejection(p_inquiry_id uuid,p_reason_ids uuid[],p_primary_id uuid,p_phase text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.property_inquiries%rowtype; ids uuid[]; chosen uuid;
BEGIN
 IF auth.uid() IS NULL OR public.my_company() IS NULL OR coalesce(public.my_role(),'') NOT IN('owner','manager','agent') THEN
  RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM public.property_inquiries WHERE id=p_inquiry_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND OR NOT crm_repair_private.can_access_client(q.company_id,q.client_id)
 OR (q.request_id IS NOT NULL AND NOT crm_repair_private.can_access_request(q.company_id,q.request_id))
 OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=q.property_id AND p.company_id=q.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 OR (public.my_role()='agent' AND q.assigned_to IS DISTINCT FROM auth.uid()) THEN
  RAISE EXCEPTION 'inquiry_not_found_or_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT x),'{}'::uuid[]) INTO ids FROM unnest(coalesce(p_reason_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
 IF cardinality(ids)>1 THEN RAISE EXCEPTION 'choose_one_primary_reason' USING ERRCODE='22023'; END IF;
 chosen:=coalesce(p_primary_id,ids[1]);
 IF chosen IS NOT NULL AND NOT chosen=ANY(ids) THEN RAISE EXCEPTION 'primary_reason_must_be_selected' USING ERRCODE='22023'; END IF;
 IF chosen IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=chosen AND (company_id=q.company_id OR company_id IS NULL) AND is_active IS TRUE) THEN
   RAISE EXCEPTION 'rejection_reason_not_allowed' USING ERRCODE='42501'; END IF;
  PERFORM crm_repair_private.set_primary_rejection(q.company_id,q.client_id,q.property_id,q.request_id,q.id,chosen,p_note,coalesce(p_phase,'unknown'),auth.uid());
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended(q.company_id::text||':rejection:'||q.client_id::text||':'||q.property_id::text||':'||coalesce(q.request_id::text,'legacy'),0));
  UPDATE public.property_rejection_reasons SET is_primary=false WHERE company_id=q.company_id AND client_id=q.client_id
   AND property_id=q.property_id AND request_id IS NOT DISTINCT FROM q.request_id AND is_primary;
 END IF;
 UPDATE public.property_inquiries SET rejection_reason=(SELECT code FROM public.rejection_reasons WHERE id=chosen),
 rejection_notes=CASE WHEN chosen IS NOT NULL THEN nullif(btrim(p_note),'') END,updated_at=now() WHERE id=q.id;
 RETURN jsonb_build_object('ok',true,'count',cardinality(ids),'inquiry_id',p_inquiry_id);
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.replace_primary_rejection(uuid,uuid[],uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.replace_primary_rejection(uuid,uuid[],uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_replace_rejection_reasons(p_inquiry_id uuid,p_reason_ids uuid[],p_primary_id uuid,p_phase text,p_note text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT crm_repair_private.replace_primary_rejection(p_inquiry_id,p_reason_ids,p_primary_id,p_phase,p_note)
$$;
REVOKE ALL ON FUNCTION public.crm_replace_rejection_reasons(uuid,uuid[],uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_replace_rejection_reasons(uuid,uuid[],uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
