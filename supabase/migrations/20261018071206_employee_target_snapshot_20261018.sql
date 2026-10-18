-- Already deployed migration, recovered verbatim from migration history.
create or replace function public.crm_employee_target_snapshot()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_company uuid:=public.my_company();v_role text:=public.my_role();v_actor uuid:=auth.uid();v_today date:=(now() at time zone 'Asia/Muscat')::date;v_week date;v_month date;v_result jsonb;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then raise exception 'not_authorized' using errcode='42501';end if;
 v_week:=v_today-((extract(dow from v_today)::int+7)%7);
 v_month:=date_trunc('month',v_today)::date;
 with employees as (
 select p.id,p.full_name,case when lower(p.full_name) like '%hadeel%' then 'muscat' when lower(p.full_name) like '%maram%' then 'barka' end branch
 from public.profiles p where p.company_id=v_company and p.role='agent' and (lower(p.full_name) like '%hadeel%' or lower(p.full_name) like '%maram%')
 and (v_role<>'agent' or p.id=v_actor)
 ), metrics as (
 select e.id,e.full_name,e.branch,
 (select count(distinct pr.id) from public.properties pr where pr.company_id=v_company and pr.branch_key=e.branch and pr.status='available' and coalesce(pr.archived,false)=false and pr.price>0 and pr.availability_checked_at is not null) inventory,
 (select count(distinct pr.id) from public.properties pr where pr.company_id=v_company and pr.branch_key=e.branch and pr.status='available' and coalesce(pr.archived,false)=false and pr.price>0 and pr.availability_checked_at is not null and (pr.created_at at time zone 'Asia/Muscat')::date>=v_week and (pr.created_at at time zone 'Asia/Muscat')::date<=v_today) additions,
 (select count(distinct a.id) from public.activities a where a.company_id=v_company and a.user_id=e.id and a.actor_type='human' and nullif(trim(coalesce(a.outcome,'')),'') is not null and (coalesce(a.occurred_at,a.created_at) at time zone 'Asia/Muscat')::date=v_today and a.type in ('call','followup','meeting','whatsapp','contact')) followups,
 (select count(distinct v.id) from public.viewings v where v.company_id=v_company and v.agent_id=e.id and v.status='done' and coalesce(v.archived,false)=false and v.viewing_date between v_week and v_today) viewings,
 (select count(distinct d.id) from public.deals d where d.company_id=v_company and d.agent_id=e.id and d.reservation_confirmed_at is not null and (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date>=v_month and (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date<=v_today) bookings,
 (select count(distinct d.id) from public.deals d where d.company_id=v_company and d.agent_id=e.id and d.reservation_confirmed_at is not null and d.reservation_cancelled_at is null and (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date>=v_month) live_bookings,
 (select coalesce(sum(d.expected_company_commission_at_reservation),0) from public.deals d where d.company_id=v_company and d.agent_id=e.id and d.reservation_confirmed_at is not null and (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date>=v_month and (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date<=v_today) expected_commission
 from employees e)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'branch',branch,'inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,'bookings',bookings,'live_bookings',live_bookings,'expected_commission',expected_commission,'sales_goal_met',(bookings>=2 or expected_commission>=4000)) order by branch),'[]'::jsonb) into v_result from metrics;
 return jsonb_build_object('today',v_today,'week_start',v_week,'month_start',v_month,'employees',v_result);
end $$;
revoke all on function public.crm_employee_target_snapshot() from public,anon;
grant execute on function public.crm_employee_target_snapshot() to authenticated,service_role;

