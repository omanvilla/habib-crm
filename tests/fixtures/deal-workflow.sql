-- Synthetic isolated extension of the real-schema visit fixture; no customer data.
\ir visit-auto-request.sql
ALTER TABLE deals ADD COLUMN agent_id uuid;
ALTER TABLE deals ADD COLUMN stage text DEFAULT 'new'::text NOT NULL;
ALTER TABLE deals ADD COLUMN deal_value numeric(12,2);
ALTER TABLE deals ADD COLUMN deposit_amount numeric(12,2);
ALTER TABLE deals ADD COLUMN closing_probability integer DEFAULT 50;
ALTER TABLE deals ADD COLUMN expected_close_date date;
ALTER TABLE deals ADD COLUMN bank_financing text;
ALTER TABLE deals ADD COLUMN notes text;
ALTER TABLE deals ADD COLUMN closed_at timestamp with time zone;
ALTER TABLE deals ADD COLUMN company_commission numeric(12,2);
ALTER TABLE deals ADD COLUMN agent_commission numeric(12,2);
ALTER TABLE deals ADD COLUMN created_at timestamp with time zone DEFAULT now();
ALTER TABLE deals ADD COLUMN updated_at timestamp with time zone DEFAULT now();
ALTER TABLE deals ADD COLUMN commission_total numeric(12,2);
ALTER TABLE deals ADD COLUMN company_share numeric(12,2);
ALTER TABLE deals ADD COLUMN agent_share numeric(12,2);
ALTER TABLE deals ADD COLUMN commission_status text DEFAULT 'pending'::text;
ALTER TABLE deals ADD COLUMN broker_id uuid;
ALTER TABLE deals ADD COLUMN broker_commission numeric(12,2);
ALTER TABLE deals ADD COLUMN request_id uuid;
ALTER TABLE deals ADD COLUMN viewing_id uuid;
ALTER TABLE deals ADD COLUMN lost_reason_id uuid;
ALTER TABLE deals ADD COLUMN lost_reason_note text;
ALTER TABLE deals ADD COLUMN lost_from_stage text;
ALTER TABLE deals ADD COLUMN lost_at timestamp with time zone;
ALTER TABLE deals ADD CONSTRAINT deals_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'viewing_scheduled'::text, 'viewing_no_show'::text, 'viewing_cancelled'::text, 'viewing_postponed'::text, 'visit'::text, 'negotiation'::text, 'deposit'::text, 'awaiting_finance'::text, 'finance_approved'::text, 'awaiting_clearance'::text, 'ownership_transfer'::text, 'closed'::text, 'commission_collected'::text, 'lost'::text])));
CREATE TABLE owners(id uuid DEFAULT gen_random_uuid() NOT NULL,
company_id uuid,
added_by uuid,
name text NOT NULL,
phone text NOT NULL,
email text,
nationality text,
id_number text,
exclusive boolean DEFAULT false,
terms text,
address text,
notes text,
archived boolean DEFAULT false,
created_at timestamp with time zone DEFAULT now(),
last_contact timestamp with time zone,
next_followup date,
rating text DEFAULT 'good'::text,
relationship_type text DEFAULT 'owner'::text,
responsive boolean DEFAULT true,
multiple_brokers boolean DEFAULT false,
total_revenue numeric(12,2) DEFAULT 0,
successful_deals integer DEFAULT 0,
failed_deals integer DEFAULT 0,
owner_type text DEFAULT 'owner'::text,
commission_rate numeric(5,2));
ALTER TABLE owners ADD CONSTRAINT owners_pkey PRIMARY KEY (id);
CREATE TABLE rejection_reasons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,label_ar text,code text,is_active boolean DEFAULT true);
CREATE TABLE deal_stage_history(id uuid DEFAULT gen_random_uuid(),deal_id uuid,company_id uuid,client_id uuid,property_id uuid,from_stage text,to_stage text,reason_id uuid,note text,changed_by uuid,changed_at timestamptz DEFAULT now());
CREATE POLICY deals_delete_admin ON deals AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));
CREATE POLICY deals_insert_staff ON deals AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));
CREATE POLICY deals_related_branch_boundary ON deals AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = deals.property_id) AND (p.company_id = deals.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = deals.property_id) AND (p.company_id = deals.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))))));
CREATE POLICY deals_select_by_role ON deals AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));
CREATE POLICY deals_update_allowed ON deals AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));
CREATE POLICY owners_delete_admin ON owners AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));
CREATE POLICY owners_insert_staff ON owners AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));
CREATE POLICY owners_select_company ON owners AS PERMISSIVE FOR SELECT TO authenticated USING ((company_id = my_company()));
CREATE POLICY owners_update_staff ON owners AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])))) WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON owners,rejection_reasons TO authenticated;
CREATE OR REPLACE FUNCTION public.record_deal_stage_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op='INSERT' or old.stage is distinct from new.stage then
    insert into public.deal_stage_history(
      company_id,deal_id,client_id,property_id,from_stage,to_stage,reason_id,note,changed_by,changed_at
    ) values (
      new.company_id,new.id,new.client_id,new.property_id,
      case when tg_op='INSERT' then null else old.stage end,
      new.stage,new.lost_reason_id,
      case when new.stage='lost' then coalesce(new.lost_reason_note,new.notes) else null end,
      auth.uid(),now()
    );
  end if;
  return new;
end;
$function$
;
REVOKE SELECT ON public.properties FROM PUBLIC,anon,authenticated;
GRANT SELECT ("id","company_id","added_by","title","type","area","price","bedrooms","bathrooms","land_size","built_size","status","description","images","views_count","inquiries_count","created_at","updated_at","owner_client_id","archived","archived_at","archived_by","owner_id","wilayat","source_type","marketing_status","property_code","internal_name","branch_key","availability_checked_at","performance_tracking_started_at","photography_status","photography_reason","photography_required_at","photography_completed_at","marketing_review_status","marketing_reviewed_at","marketing_review_note","last_ai_recommendation","last_ai_recommendation_at","public_details","map_url","has_listing_agreement","agreement_start_date","agreement_duration_months","agreement_end_date","agreement_reminder_days") ON public.properties TO authenticated;
CREATE OR REPLACE FUNCTION crm_repair_private.guard_properties_financial_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND ((NEW."owner_net" IS NOT NULL) OR (NEW."expected_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."owner_net" IS DISTINCT FROM OLD."owner_net") OR (NEW."expected_commission" IS DISTINCT FROM OLD."expected_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_properties_financial_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_properties_financial_fields BEFORE INSERT OR UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_properties_financial_fields();

REVOKE SELECT ON public.deals FROM PUBLIC,anon,authenticated;
GRANT SELECT ("id","company_id","client_id","property_id","agent_id","stage","deal_value","deposit_amount","closing_probability","expected_close_date","bank_financing","notes","closed_at","created_at","updated_at","broker_id","request_id","viewing_id","lost_reason_id","lost_reason_note","lost_from_stage","lost_at") ON public.deals TO authenticated;
CREATE OR REPLACE FUNCTION crm_repair_private.guard_deals_financial_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND NEW.stage='commission_collected') OR (TG_OP='UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage AND (NEW.stage='commission_collected' OR OLD.stage='commission_collected')) THEN
   RAISE EXCEPTION 'تأكيد تحصيل العمولة أو تغييره متاح لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
  IF (TG_OP='INSERT' AND ((NEW."company_commission" IS NOT NULL) OR (NEW."agent_commission" IS NOT NULL) OR (NEW."commission_total" IS NOT NULL) OR (NEW."company_share" IS NOT NULL) OR (NEW."agent_share" IS NOT NULL) OR (NEW."commission_status" IS NOT NULL AND NEW."commission_status" <> 'pending') OR (NEW."broker_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."company_commission" IS DISTINCT FROM OLD."company_commission") OR (NEW."agent_commission" IS DISTINCT FROM OLD."agent_commission") OR (NEW."commission_total" IS DISTINCT FROM OLD."commission_total") OR (NEW."company_share" IS DISTINCT FROM OLD."company_share") OR (NEW."agent_share" IS DISTINCT FROM OLD."agent_share") OR (NEW."commission_status" IS DISTINCT FROM OLD."commission_status") OR (NEW."broker_commission" IS DISTINCT FROM OLD."broker_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_deals_financial_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_deals_financial_fields BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_deals_financial_fields();

NOTIFY pgrst, 'reload schema';


ALTER TABLE deals ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE property_inquiries ADD COLUMN shown_by_agent boolean, ADD COLUMN post_visit_interest text, ADD COLUMN outcome text, ADD COLUMN rejection_reason text, ADD COLUMN rejection_notes text, ADD COLUMN last_contact_at timestamptz, ADD COLUMN followup_note text, ADD COLUMN next_followup date;
CREATE TABLE property_rejection_reasons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,property_inquiry_id uuid,client_id uuid,request_id uuid,property_id uuid,reason_id uuid,is_primary boolean,phase text,note text,created_by uuid,created_at timestamptz DEFAULT now(),UNIQUE(company_id,property_inquiry_id,reason_id));
CREATE TRIGGER record_deal_history AFTER INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION record_deal_stage_history();
CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    and (v_request_id is null or pi.request_id=v_request_id or pi.request_id is null)
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
      new.rejection_reason,coalesce(new.outcome_note,new.notes),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  elsif v_inquiry_id is not null then
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=coalesce(request_id,v_request_id),
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=exists(select 1 from public.viewings vx where vx.company_id=new.company_id and vx.client_id=new.client_id and vx.property_id=new.property_id and vx.archived=false and vx.status='done' and (v_request_id is null or vx.request_id=v_request_id)),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then coalesce(new.outcome_note,new.notes,rejection_notes) else rejection_notes end,
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
    else 'no_clear_reason' end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and is_active=true limit 1;

  if v_target_stage='lost' and v_reason_id is not null then
    insert into public.property_rejection_reasons(
      company_id,property_inquiry_id,client_id,request_id,property_id,reason_id,is_primary,phase,note,created_by
    ) values (
      new.company_id,v_inquiry_id,new.client_id,v_request_id,new.property_id,v_reason_id,true,'post_visit',coalesce(new.outcome_note,new.notes,new.rejection_reason),new.created_by
    ) on conflict (company_id,property_inquiry_id,reason_id)
      do update set is_primary=true,phase='post_visit',note=excluded.note;
  end if;

  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and (v_request_id is null or d.request_id=v_request_id or d.request_id is null)
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then coalesce(new.outcome_note,new.notes,new.rejection_reason) end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=coalesce(request_id,v_request_id),agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=coalesce(new.outcome_note,new.notes,new.rejection_reason),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=coalesce(request_id,v_request_id),agent_id=coalesce(new.agent_id,agent_id),
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
          request_id=coalesce(request_id,v_request_id),
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;



CREATE TRIGGER sync_viewing_crm AFTER INSERT OR UPDATE ON viewings FOR EACH ROW EXECUTE FUNCTION sync_viewing_to_crm();

ALTER TABLE property_inquiries DROP CONSTRAINT IF EXISTS property_inquiries_company_id_client_id_property_id_key;
CREATE UNIQUE INDEX pi_request_unique ON property_inquiries(company_id,request_id,property_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX pi_legacy_unique ON property_inquiries(company_id,client_id,property_id) WHERE request_id IS NULL;
-- Real legacy rows predate SQL14; never rewrite their missing evidence or authored dates.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,notes,created_at,updated_at,closed_at,commission_total,broker_commission,company_share,agent_share,commission_status) VALUES
('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','lost','تم إنشاؤها تلقائياً من زيارة بتاريخ 2026-06-29','2020-02-03T04:05:06Z','2022-02-03T04:05:06Z',null,null,null,null,null,'pending'),
('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000003','commission_collected','Original historical note','2020-02-03T04:05:06Z','2022-02-03T04:05:06Z',null,1000,200,617,183,'received');
