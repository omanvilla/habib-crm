-- Correct dashboard conversion periods without changing any business records.
-- SQL18 investment authorization and existing employee/branch credit remain intact.
-- The employee team report excludes investment evidence even for the owner;
-- private investor work belongs to the owner dashboard section, never branch totals.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.dashboard_performance_backup_20261015 (
 object_identity text PRIMARY KEY,
 original_definition text NOT NULL,
 applied_definition text,
 captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.dashboard_performance_backup_20261015 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.dashboard_performance_backup_20261015 FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
BEGIN
 IF position('crm_repair_private.investment_row_allowed' in pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'SQL18 investment authorization must be applied before dashboard performance';
 END IF;
END $guard$;
INSERT INTO crm_repair_private.dashboard_performance_backup_20261015(object_identity,original_definition)
SELECT 'public.crm_employee_performance(date,date)',pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure)
ON CONFLICT(object_identity) DO NOTHING;

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
   from public.deals hd where (crm_repair_private.investment_row_allowed(hd.company_id,to_jsonb(hd)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(hd.company_id,to_jsonb(hd)))) and hd.company_id=c.id and hd.stage in('closed','commission_collected')
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
  select wc.id,wc.company_id,wc.route_key from public.whatsapp_conversations wc
  where wc.company_id=v_company and exists(select 1 from outbound_candidates m where m.conversation_id=wc.id)
   and crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(wc.company_id,to_jsonb(wc)))
   and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(wc.company_id,wc.id))
 ), outbound_credit as materialized (
  select crm_repair_private.performance_employee(mm.company_id,wc.route_key,mm.message_timestamp,mm.sent_by_user_id) employee_id
  from outbound_candidates mm left join outbound_conversations wc on wc.id=mm.conversation_id and wc.company_id=mm.company_id
  where crm_repair_private.investment_row_allowed(mm.company_id,to_jsonb(mm))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(mm.company_id,to_jsonb(mm)))
   and (v_role<>'agent' or wc.id is not null)
 ), outbound_counts as (select employee_id,count(*) outbound from outbound_credit group by employee_id)
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(d.with_visit,0),
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
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$
;
UPDATE crm_repair_private.dashboard_performance_backup_20261015
SET applied_definition=pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure)
WHERE object_identity='public.crm_employee_performance(date,date)';

