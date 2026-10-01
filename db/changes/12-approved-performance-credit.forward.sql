-- Prepared on the review branch; NOT applied to production in this round.
-- Reporting attribution preserves authored records, original dates and amounts.
CREATE OR REPLACE FUNCTION crm_repair_private.performance_employee(
 p_company uuid,p_branch text,p_at timestamptz,p_original uuid
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((
  SELECT o.employee_id FROM crm_repair_private.branch_performance_owners o
  JOIN public.profiles e ON e.id=o.employee_id AND e.company_id=o.company_id AND e.is_active AND e.role='agent'
  WHERE o.company_id=p_company AND o.branch_key=p_branch
   AND p_at>=o.effective_from::timestamp AT TIME ZONE 'Asia/Muscat'
 ),p_original)
$$;
REVOKE ALL ON FUNCTION crm_repair_private.performance_employee(uuid,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
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
 select (created_at at time zone 'Asia/Muscat')::date into v_inception from public.companies where id=v_company;
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
   from public.properties p where p.company_id=e.company_id and crm_repair_private.performance_employee(p.company_id,p.branch_key,p.created_at,p.sourced_by)=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where pi.company_id=e.company_id and crm_repair_private.performance_employee(pi.company_id,(select pp.branch_key from public.properties pp where pp.id=pi.property_id and pp.company_id=pi.company_id),pi.first_inquiry_at,pi.assigned_to)=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to
      and exists(select 1 from public.deals dd where dd.company_id=vv.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
        and dd.client_id=vv.client_id and dd.property_id=vv.property_id
        and dd.stage in('closed','commission_collected') and dd.closed_at>=vv.viewing_date::timestamp at time zone 'Asia/Muscat')) to_sale
   from public.viewings vv where vv.company_id=e.company_id and crm_repair_private.performance_employee(vv.company_id,(select pp.branch_key from public.properties pp where pp.id=vv.property_id and pp.company_id=vv.company_id),vv.created_at,vv.agent_id)=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   select count(*) sales,sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where dd.company_id=e.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where aa.company_id=e.company_id and crm_repair_private.performance_employee(aa.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where cc.id=aa.client_id and cc.company_id=aa.company_id)),coalesce(aa.occurred_at,aa.created_at),aa.user_id)=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   select count(*) outbound from public.whatsapp_messages mm
   where mm.company_id=e.company_id and crm_repair_private.performance_employee(mm.company_id,(select wc.route_key from public.whatsapp_conversations wc where wc.id=mm.conversation_id and wc.company_id=mm.company_id),mm.message_timestamp,mm.sent_by_user_id)=e.id and mm.direction='outbound' and mm.actor_type='human' and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(mm.company_id,mm.conversation_id))
    and mm.message_timestamp>=v_start and mm.message_timestamp<v_end
 ) w on true
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$;

REVOKE ALL ON FUNCTION public.crm_employee_performance(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_employee_performance(date,date) TO authenticated;
