-- SQL18 companion: append after investment_row_allowed is installed.
-- Keep the live RPC signatures, grants, finance masking, and Muscat/Barka predicates.
-- These existing definer surfaces require explicit guards because they bypass RLS.
-- The parent migration captures their exact original definitions before this file runs.

CREATE OR REPLACE VIEW public.crm_properties_access AS
 SELECT id,
    company_id,
    added_by,
    title,
    type,
    area,
    price,
    bedrooms,
    bathrooms,
    land_size,
    built_size,
    status,
    description,
    images,
    views_count,
    inquiries_count,
    created_at,
    updated_at,
    owner_client_id,
    archived,
    archived_at,
    archived_by,
    owner_id,
        CASE
            WHEN my_role() = 'owner'::text THEN owner_net
            ELSE NULL::numeric
        END AS owner_net,
    wilayat,
    source_type,
    marketing_status,
        CASE
            WHEN my_role() = 'owner'::text THEN expected_commission
            ELSE NULL::numeric
        END AS expected_commission,
    property_code,
    internal_name,
    branch_key,
    availability_checked_at,
    performance_tracking_started_at,
    photography_status,
    photography_reason,
    photography_required_at,
    photography_completed_at,
    marketing_review_status,
    marketing_reviewed_at,
    marketing_review_note,
    last_ai_recommendation,
    last_ai_recommendation_at,
    public_details,
    map_url,
    has_listing_agreement,
    agreement_start_date,
    agreement_duration_months,
    agreement_end_date,
    agreement_reminder_days,
    sourced_by
   FROM properties t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t)) AND crm_repair_private.staff_can_access_branch(company_id, branch_key);

CREATE OR REPLACE VIEW public.crm_deals_access AS
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
        CASE
            WHEN my_role() = 'owner'::text THEN commission_received_at
            ELSE NULL::timestamp with time zone
        END AS commission_received_at,
        CASE
            WHEN my_role() = 'owner'::text THEN employee_commission_percent
            ELSE NULL::numeric
        END AS employee_commission_percent
   FROM deals t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t)) AND (property_id IS NULL OR (EXISTS ( SELECT 1
           FROM properties p
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.investment_row_allowed(p.company_id, to_jsonb(p)) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id)));

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
   select min((hd.closed_at at time zone 'Asia/Muscat')::date)
   from public.deals hd where crm_repair_private.investment_row_allowed(hd.company_id,to_jsonb(hd)) and hd.company_id=c.id and hd.stage in('closed','commission_collected')
    and (v_role<>'agent' or (hd.agent_id=v_actor
      and crm_repair_private.can_access_client(hd.company_id,hd.client_id)
      and (hd.property_id is null or exists(select 1 from public.properties hp where crm_repair_private.investment_row_allowed(hp.company_id,to_jsonb(hp)) and hp.id=hd.property_id and hp.company_id=hd.company_id and crm_repair_private.staff_can_access_branch(hp.company_id,hp.branch_key)))))
 )) into v_inception from public.companies c where c.id=v_company;
 if p_from is null then p_from:=v_inception;end if;
 if p_from is null or p_to is null or p_to<=p_from then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(v.to_sale,0),
   'sales',coalesce(d.sales,0),
   'company_commission',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),
   'outbound_messages',coalesce(w.outbound,0),
   'targets',jsonb_build_object('inventory_target',10)||coalesce(to_jsonb(t)-'company_id'-'employee_id'-'month_start'-'updated_at','{}'::jsonb)
 )),'[]'::jsonb) into v_result
 from public.profiles e
 left join public.employee_monthly_targets t on t.company_id=e.company_id and t.employee_id=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   select count(*) filter(where p.archived=false and p.status not in('sold','not_available')) active_inventory,
    count(*) filter(where p.created_at>=v_start and p.created_at<v_end) new_properties
   from public.properties p where crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p)) and p.company_id=e.company_id and crm_repair_private.performance_employee(p.company_id,p.branch_key,p.created_at,p.sourced_by)=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi)) and pi.company_id=e.company_id and crm_repair_private.performance_employee(pi.company_id,(select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=pi.property_id and pp.company_id=pi.company_id),pi.first_inquiry_at,pi.assigned_to)=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to
      and exists(select 1 from public.deals dd where crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and dd.company_id=vv.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
        and dd.client_id=vv.client_id and dd.property_id=vv.property_id
        and dd.stage in('closed','commission_collected') and dd.closed_at>=vv.viewing_date::timestamp at time zone 'Asia/Muscat')) to_sale
   from public.viewings vv where crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and vv.company_id=e.company_id and crm_repair_private.performance_employee(vv.company_id,(select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=vv.property_id and pp.company_id=vv.company_id),vv.created_at,vv.agent_id)=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   select count(*) sales,sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and dd.company_id=e.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where crm_repair_private.investment_row_allowed(aa.company_id,to_jsonb(aa)) and aa.company_id=e.company_id and crm_repair_private.performance_employee(aa.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=aa.client_id and cc.company_id=aa.company_id)),coalesce(aa.occurred_at,aa.created_at),aa.user_id)=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   select count(*) outbound from public.whatsapp_messages mm
   where crm_repair_private.investment_row_allowed(mm.company_id,to_jsonb(mm)) and mm.company_id=e.company_id and crm_repair_private.performance_employee(mm.company_id,(select wc.route_key from public.whatsapp_conversations wc where crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc)) and wc.id=mm.conversation_id and wc.company_id=mm.company_id),mm.message_timestamp,mm.sent_by_user_id)=e.id and mm.direction='outbound' and mm.actor_type='human' and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(mm.company_id,mm.conversation_id))
    and mm.message_timestamp>=v_start and mm.message_timestamp<v_end
 ) w on true
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_mark_instagram_read(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.instagram_conversations%rowtype; m public.instagram_messages%rowtype; n int;
 v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT ic.* INTO c FROM public.instagram_conversations ic WHERE ic.id=p_conversation_id AND ic.company_id=v_company
  AND crm_repair_private.investment_row_allowed(ic.company_id,to_jsonb(ic))
  AND (v_role IN ('owner','manager') OR ic.assigned_to=auth.uid() OR EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=ic.client_id AND cc.company_id=v_company AND cc.assigned_to=auth.uid()
    AND crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)))) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT im.* INTO m FROM public.instagram_messages im WHERE im.id=p_message_id AND im.conversation_id=c.id AND im.company_id=v_company
  AND crm_repair_private.investment_row_allowed(im.company_id,to_jsonb(im));
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.instagram_messages im WHERE im.conversation_id=c.id AND im.company_id=v_company AND im.direction='inbound' AND im.ingestion_seq>c.read_through_seq
  AND crm_repair_private.investment_row_allowed(im.company_id,to_jsonb(im));
 UPDATE public.instagram_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $function$;

CREATE OR REPLACE FUNCTION public.crm_public_business_routes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('route_key',route_key,'label',label,'whatsapp_number',whatsapp_number) ORDER BY route_key),'[]'::jsonb) INTO result
 FROM public.company_lead_routes WHERE company_id=v_company AND is_active AND nullif(trim(whatsapp_number),'') IS NOT NULL
 AND (v_role='owner' OR route_key IS DISTINCT FROM 'investment')
 AND (v_role IN ('owner','manager') OR NOT coalesce(owner_only_inbox,false));
 RETURN result;
END $function$;
