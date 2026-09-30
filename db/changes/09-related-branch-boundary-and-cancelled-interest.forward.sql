-- Preserve records and assignments; constrain authenticated access to linked branch records.
CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(c.lead_route,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,c.lead_route)) AND (c.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_requests r
          WHERE r.company_id=p.company_id AND r.client_id=c.id AND
            ((r.assigned_to=p.id AND r.status<>'archived') OR
              (r.status IN ('active','paused') AND EXISTS(
                SELECT 1 FROM public.client_request_assignees a
                WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id))))))))
  )
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(r.branch_key,r.route_key,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,coalesce(r.branch_key,r.route_key))) AND (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))
  )
$function$;

CREATE POLICY viewings_related_branch_boundary ON public.viewings AS RESTRICTIVE FOR ALL TO authenticated USING (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=viewings.property_id AND p.company_id=viewings.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))))) WITH CHECK (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=viewings.property_id AND p.company_id=viewings.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))));
CREATE POLICY deals_related_branch_boundary ON public.deals AS RESTRICTIVE FOR ALL TO authenticated USING (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=deals.property_id AND p.company_id=deals.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))))) WITH CHECK (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=deals.property_id AND p.company_id=deals.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))));
CREATE POLICY appointments_related_branch_boundary ON public.appointments AS RESTRICTIVE FOR ALL TO authenticated USING (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (coalesce(branch_key,'general')='general' OR crm_repair_private.staff_can_access_branch(company_id,branch_key)))) WITH CHECK (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (coalesce(branch_key,'general')='general' OR crm_repair_private.staff_can_access_branch(company_id,branch_key))));
CREATE POLICY activities_related_branch_boundary ON public.activities AS RESTRICTIVE FOR ALL TO authenticated USING (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=activities.property_id AND p.company_id=activities.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))) AND (deal_id IS NULL OR EXISTS(SELECT 1 FROM public.deals d WHERE d.id=activities.deal_id AND d.company_id=activities.company_id)) AND (appointment_id IS NULL OR EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=activities.appointment_id AND a.company_id=activities.company_id)))) WITH CHECK (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (property_id IS NULL OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id=activities.property_id AND p.company_id=activities.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))) AND (deal_id IS NULL OR EXISTS(SELECT 1 FROM public.deals d WHERE d.id=activities.deal_id AND d.company_id=activities.company_id)) AND (appointment_id IS NULL OR EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=activities.appointment_id AND a.company_id=activities.company_id))));
CREATE POLICY tasks_related_branch_boundary ON public.tasks AS RESTRICTIVE FOR ALL TO authenticated USING (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (deal_id IS NULL OR EXISTS(SELECT 1 FROM public.deals d WHERE d.id=tasks.deal_id AND d.company_id=tasks.company_id)) AND (viewing_id IS NULL OR EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=tasks.viewing_id AND v.company_id=tasks.company_id)))) WITH CHECK (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id)) AND (deal_id IS NULL OR EXISTS(SELECT 1 FROM public.deals d WHERE d.id=tasks.deal_id AND d.company_id=tasks.company_id)) AND (viewing_id IS NULL OR EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=tasks.viewing_id AND v.company_id=tasks.company_id))));

CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS SELECT id,
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
            WHEN (my_role() = 'owner'::text) THEN company_commission
            ELSE NULL::numeric
        END AS company_commission,
        CASE
            WHEN (my_role() = 'owner'::text) THEN agent_commission
            ELSE NULL::numeric
        END AS agent_commission,
    created_at,
    updated_at,
        CASE
            WHEN (my_role() = 'owner'::text) THEN commission_total
            ELSE NULL::numeric
        END AS commission_total,
        CASE
            WHEN (my_role() = 'owner'::text) THEN company_share
            ELSE NULL::numeric
        END AS company_share,
        CASE
            WHEN (my_role() = 'owner'::text) THEN agent_share
            ELSE NULL::numeric
        END AS agent_share,
        CASE
            WHEN (my_role() = 'owner'::text) THEN commission_status
            ELSE NULL::text
        END AS commission_status,
    broker_id,
        CASE
            WHEN (my_role() = 'owner'::text) THEN broker_commission
            ELSE NULL::numeric
        END AS broker_commission,
    request_id,
    viewing_id,
    lost_reason_id,
    lost_reason_note,
    lost_from_stage,
    lost_at
   FROM deals t
  WHERE ((company_id = my_company()) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
           FROM properties p
          WHERE ((p.id = t.property_id) AND (p.company_id = t.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))) AND (public.my_role() IN ('owner','manager','viewer') OR ((client_id IS NULL OR crm_repair_private.can_access_client(company_id,client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id,request_id))));

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


CREATE OR REPLACE FUNCTION public.sync_property_interest_from_appointment_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a public.appointments%rowtype;
begin
  select * into a from public.appointments where id=new.appointment_id and company_id=new.company_id;
  if not found or a.request_id is null or a.status='cancelled' then return new; end if;

  insert into public.property_inquiries(
    company_id,client_id,property_id,request_id,assigned_to,source,source_detail,status,
    first_inquiry_at,last_inquiry_at,inquiry_count,created_by,created_at,updated_at,
    viewing_booked,viewing_completed,has_inbound_inquiry
  ) values(
    new.company_id,a.client_id,new.property_id,a.request_id,a.agent_id,'other','تم إنشاؤه تلقائياً من المعاينة',
    case when a.status='attended' then 'viewed' else 'viewing_scheduled' end,
    coalesce(a.booked_at,a.created_at,now()),coalesce(a.appointment_at,a.booked_at,now()),1,a.created_by,
    coalesce(new.created_at,now()),now(),true,(a.status='attended'),false
  )
  on conflict (company_id,request_id,property_id) where request_id is not null
  do update set
    viewing_booked=true,
    viewing_completed=public.property_inquiries.viewing_completed or excluded.viewing_completed,
    status=case when excluded.viewing_completed then 'viewed'
                when public.property_inquiries.status in ('inquiry','followup') then 'viewing_scheduled'
                else public.property_inquiries.status end,
    last_inquiry_at=greatest(public.property_inquiries.last_inquiry_at,excluded.last_inquiry_at),
    updated_at=now();
  return new;
end;
$function$;

