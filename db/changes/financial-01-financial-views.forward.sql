CREATE OR REPLACE VIEW public.crm_properties_access WITH (security_barrier=true) AS
SELECT t."id",
  t."company_id",
  t."added_by",
  t."title",
  t."type",
  t."area",
  t."price",
  t."bedrooms",
  t."bathrooms",
  t."land_size",
  t."built_size",
  t."status",
  t."description",
  t."images",
  t."views_count",
  t."inquiries_count",
  t."created_at",
  t."updated_at",
  t."owner_client_id",
  t."archived",
  t."archived_at",
  t."archived_by",
  t."owner_id",
  CASE WHEN public.my_role() = 'owner' THEN t."owner_net" ELSE NULL END AS "owner_net",
  t."wilayat",
  t."source_type",
  t."marketing_status",
  CASE WHEN public.my_role() = 'owner' THEN t."expected_commission" ELSE NULL END AS "expected_commission",
  t."property_code",
  t."internal_name",
  t."branch_key",
  t."availability_checked_at",
  t."performance_tracking_started_at",
  t."photography_status",
  t."photography_reason",
  t."photography_required_at",
  t."photography_completed_at",
  t."marketing_review_status",
  t."marketing_reviewed_at",
  t."marketing_review_note",
  t."last_ai_recommendation",
  t."last_ai_recommendation_at",
  t."public_details",
  t."map_url",
  t."has_listing_agreement",
  t."agreement_start_date",
  t."agreement_duration_months",
  t."agreement_end_date",
  t."agreement_reminder_days"
FROM public.properties t
WHERE t.company_id = public.my_company();
REVOKE ALL ON public.crm_properties_access FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.crm_properties_access TO authenticated,service_role;
COMMENT ON VIEW public.crm_properties_access IS 'Read-only projection. Explicit active-company row authorization mirrors base RLS; confidential finance is owner-only. Base confidential SELECT is revoked separately. Do not remove predicates.';

CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS
SELECT t."id",
  t."company_id",
  t."client_id",
  t."property_id",
  t."agent_id",
  t."stage",
  t."deal_value",
  t."deposit_amount",
  t."closing_probability",
  t."expected_close_date",
  t."bank_financing",
  t."notes",
  t."closed_at",
  CASE WHEN public.my_role() = 'owner' THEN t."company_commission" ELSE NULL END AS "company_commission",
  CASE WHEN public.my_role() = 'owner' THEN t."agent_commission" ELSE NULL END AS "agent_commission",
  t."created_at",
  t."updated_at",
  CASE WHEN public.my_role() = 'owner' THEN t."commission_total" ELSE NULL END AS "commission_total",
  CASE WHEN public.my_role() = 'owner' THEN t."company_share" ELSE NULL END AS "company_share",
  CASE WHEN public.my_role() = 'owner' THEN t."agent_share" ELSE NULL END AS "agent_share",
  CASE WHEN public.my_role() = 'owner' THEN t."commission_status" ELSE NULL END AS "commission_status",
  t."broker_id",
  CASE WHEN public.my_role() = 'owner' THEN t."broker_commission" ELSE NULL END AS "broker_commission",
  t."request_id",
  t."viewing_id",
  t."lost_reason_id",
  t."lost_reason_note",
  t."lost_from_stage",
  t."lost_at"
FROM public.deals t
WHERE t.company_id = public.my_company() AND (public.my_role() IN ('owner','manager','viewer') OR (public.my_role() = 'agent' AND t.agent_id = auth.uid()));
REVOKE ALL ON public.crm_deals_access FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.crm_deals_access TO authenticated,service_role;
COMMENT ON VIEW public.crm_deals_access IS 'Read-only projection. Explicit active-company row authorization mirrors base RLS; confidential finance is owner-only. Base confidential SELECT is revoked separately. Do not remove predicates.';

CREATE OR REPLACE FUNCTION public.crm_client_360(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with c as (
  select * from public.clients
  where id=p_client_id and company_id=(select my_company())
), req as (
  select * from public.client_requests
  where client_id=p_client_id and company_id=(select my_company())
), pi as (
  select x.*, p.title as property_title, p.area as property_area, p.price as property_price
  from public.property_inquiries x
  join public.crm_properties_access p on p.id=x.property_id
  where x.client_id=p_client_id and x.company_id=(select my_company())
), ap as (
  select * from public.appointments
  where client_id=p_client_id and company_id=(select my_company())
), vw as (
  select v.*, p.title as property_title
  from public.viewings v
  left join public.crm_properties_access p on p.id=v.property_id
  where v.client_id=p_client_id and v.company_id=(select my_company())
), dl as (
  select d.*, p.title as property_title
  from public.crm_deals_access d
  left join public.crm_properties_access p on p.id=d.property_id
  where d.client_id=p_client_id and d.company_id=(select my_company())
), dp as (
  select dep.* from public.deposits dep join dl d on d.id=dep.deal_id
), rr as (
  select r.label_ar, r.code, count(distinct pr.property_id)::bigint as properties_count
  from public.property_rejection_reasons pr
  join public.rejection_reasons r on r.id=pr.reason_id
  where pr.client_id=p_client_id and pr.company_id=(select my_company())
  group by r.label_ar,r.code
  order by count(distinct pr.property_id) desc, min(r.sort_order)
), wa as (
  select wm.id,wm.direction,wm.message_type,wm.body,wm.message_timestamp,wm.delivery_status,wm.request_id,wm.sent_by_user_id
  from public.whatsapp_messages wm
  where wm.client_id=p_client_id and wm.company_id=(select my_company())
), act as (
  select a.id,a.activity_type,a.activity_text,a.created_at,a.request_id,a.property_id,a.appointment_id,a.deal_id,a.user_id
  from public.activities a
  where a.client_id=p_client_id and a.company_id=(select my_company())
), tsk as (
  select t.id,t.title,t.notes,t.due_date,t.priority,t.done,t.request_id,t.deal_id,t.user_id,t.created_at
  from public.tasks t
  where t.client_id=p_client_id and t.company_id=(select my_company())
)
select jsonb_build_object(
  'client',(select to_jsonb(c.*) from c limit 1),
  'customer_kind',case when (select count(*) from req)>1 then 'returning' else 'new_or_single_request' end,
  'metrics',jsonb_build_object(
    'requests_total',(select count(*) from req),
    'active_requests',(select count(*) from req where status='active'),
    'properties_inquired',(select count(distinct property_id) from pi where has_inbound_inquiry=true),
    'properties_shown',(select count(distinct property_id) from pi where shown_by_agent=true),
    'properties_visited',(select count(distinct property_id) from vw where coalesce(archived,false)=false and status='done'),
    'rejected_properties',(select count(distinct property_id) from pi where status='not_suitable' or outcome='rejected'),
    'appointments_total',(select count(*) from ap),
    'appointments_attended',(select count(*) from ap where status='attended' or attended_at is not null),
    'appointments_no_show',(select count(*) from ap where status='no_show'),
    'negotiations',(select count(*) from dl where stage in ('negotiation','negotiating')),
    'deposits',(select count(*) from dp),
    'closed_deals',(select count(*) from dl where stage in ('closed','commission_collected')),
    'overdue_followups',(select count(*) from req where status='active' and next_followup<current_date),
    'whatsapp_inbound',(select count(*) from wa where direction='inbound'),
    'whatsapp_outbound',(select count(*) from wa where direction='outbound'),
    'activities_total',(select count(*) from act),
    'open_tasks',(select count(*) from tsk where done=false),
    'overdue_tasks',(select count(*) from tsk where done=false and due_date<current_date)
  ),
  'active_request',(select to_jsonb(x.*) from req x where x.status='active' order by x.created_at desc limit 1),
  'last_mutual_contact_at',(select max(last_mutual_contact_at) from req),
  'next_followup',(select min(next_followup) from req where status='active' and next_followup is not null),
  'last_whatsapp_at',(select max(message_timestamp) from wa),
  'requests',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from req x),'[]'::jsonb),
  'property_journey',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.last_contact_at desc nulls last, x.last_inquiry_at desc) from pi x),'[]'::jsonb),
  'appointments',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.appointment_at desc) from ap x),'[]'::jsonb),
  'viewings',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.viewing_date desc) from vw x),'[]'::jsonb),
  'deals',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from dl x),'[]'::jsonb),
  'top_rejection_reasons',coalesce((select jsonb_agg(to_jsonb(x.*)) from rr x),'[]'::jsonb),
  'recent_whatsapp',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.message_timestamp desc) from (select * from wa order by message_timestamp desc limit 20) x),'[]'::jsonb),
  'recent_activities',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from (select * from act order by created_at desc limit 20) x),'[]'::jsonb),
  'open_tasks',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.due_date asc nulls last) from (select * from tsk where done=false order by due_date asc nulls last limit 20) x),'[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.crm_property_action_queue(p_branch_key text DEFAULT NULL::text)
 RETURNS TABLE(property_id uuid, title text, property_code text, internal_name text, branch_key text, area text, property_status text, photography_status text, photography_reason text, created_at timestamp with time zone, tracking_started_at timestamp with time zone, last_inquiry_at timestamp with time zone, days_without_inquiry integer, unique_inquirers bigint, inquiry_events bigint, completed_viewings bigint, unique_visitors bigint, rejected_clients bigint, negotiations bigint, closed_deals bigint, last_marketing_at timestamp with time zone, top_rejection_code text, top_rejection_label text, top_rejection_category text, top_rejection_clients bigint, alert_type text, alert_priority text, recommendation_rule jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with marketing_stats as (
  select pm.property_id,
         max(coalesce(pm.published_at,pm.created_at)) filter(where pm.event_type='publish') as last_marketing_at,
         max(coalesce(pm.published_at,pm.created_at)) filter(
           where pm.event_type='publish' and (
             pm.channel='instagram' or pm.link_provider='instagram'
             or public.normalize_property_marketing_link(pm.url) like 'instagram:%'
             or public.normalize_property_marketing_link(pm.url) like 'instagram-share:%'
           )
         ) as last_instagram_publish_at
  from public.property_marketing_events pm
  group by pm.property_id
), prop_base as (
  select p.*,m.last_marketing_at,m.last_instagram_publish_at
  from public.crm_properties_access p
  left join marketing_stats m on m.property_id=p.id
  where p.company_id=(select public.my_company())
    and coalesce(p.archived,false)=false
    and coalesce(p.status,'available') not in ('sold','not_available')
    and (p_branch_key is null or p.branch_key=p_branch_key)
), inquiry_stats as (
  select pi.property_id,
         max(pi.last_inquiry_at) filter(where pi.has_inbound_inquiry=true) as last_inquiry_at,
         count(distinct pi.client_id) filter(where pi.has_inbound_inquiry=true) as unique_inquirers,
         coalesce(sum(pi.inquiry_count) filter(where pi.has_inbound_inquiry=true),0)::bigint as inquiry_events,
         count(distinct pi.client_id) filter(where pi.status='not_suitable' or pi.outcome='rejected') as rejected_clients,
         count(distinct pi.client_id) filter(where pi.status='negotiation' or pi.outcome='negotiation') as negotiations
  from public.property_inquiries pi
  join prop_base p on p.id=pi.property_id
  group by pi.property_id
), viewing_stats as (
  select v.property_id,
         count(*) filter(where coalesce(v.archived,false)=false and v.status='done') as completed_viewings,
         count(distinct v.client_id) filter(where coalesce(v.archived,false)=false and v.status='done') as unique_visitors
  from public.viewings v join prop_base p on p.id=v.property_id
  group by v.property_id
), deal_stats as (
  select d.property_id,count(*) filter(where d.stage in ('closed','commission_collected')) as closed_deals
  from public.crm_deals_access d join prop_base p on p.id=d.property_id
  group by d.property_id
), rejection_ranked as (
  select pr.property_id,rr.code,rr.label_ar,rr.category,count(distinct pr.client_id)::bigint as client_count,
         row_number() over(partition by pr.property_id order by count(distinct pr.client_id) desc,min(rr.sort_order),rr.code) as rn
  from public.property_rejection_reasons pr
  join public.rejection_reasons rr on rr.id=pr.reason_id
  join prop_base p on p.id=pr.property_id
  where pr.created_at >= coalesce(p.last_marketing_at,p.performance_tracking_started_at,p.created_at)
  group by pr.property_id,rr.code,rr.label_ar,rr.category
), base as (
  select p.*,i.last_inquiry_at,coalesce(i.unique_inquirers,0)::bigint unique_inquirers,
         coalesce(i.inquiry_events,0)::bigint inquiry_events,coalesce(i.rejected_clients,0)::bigint rejected_clients,
         coalesce(i.negotiations,0)::bigint negotiations,coalesce(v.completed_viewings,0)::bigint completed_viewings,
         coalesce(v.unique_visitors,0)::bigint unique_visitors,coalesce(d.closed_deals,0)::bigint closed_deals,
         r.code top_rejection_code,r.label_ar top_rejection_label,r.category top_rejection_category,
         coalesce(r.client_count,0)::bigint top_rejection_clients,
         case when p.last_marketing_at is null then null
              else greatest(coalesce(i.last_inquiry_at,p.last_marketing_at),p.last_marketing_at)
         end as tracking_anchor
  from prop_base p
  left join inquiry_stats i on i.property_id=p.id
  left join viewing_stats v on v.property_id=p.id
  left join deal_stats d on d.property_id=p.id
  left join rejection_ranked r on r.property_id=p.id and r.rn=1
), scored as (
  select b.*,case when b.tracking_anchor is null then null else greatest(0,floor(extract(epoch from (now()-b.tracking_anchor))/86400)::int) end as days_without_inquiry
  from base b
)
select b.id,b.title,b.property_code,b.internal_name,b.branch_key,b.area,b.status,b.photography_status,b.photography_reason,
       b.created_at,b.performance_tracking_started_at,b.last_inquiry_at,b.days_without_inquiry,b.unique_inquirers,b.inquiry_events,
       b.completed_viewings,b.unique_visitors,b.rejected_clients,b.negotiations,b.closed_deals,b.last_marketing_at,
       b.top_rejection_code,b.top_rejection_label,b.top_rejection_category,b.top_rejection_clients,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then 'new_needs_photography'
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 'no_inquiry_5d'
         when b.top_rejection_clients>=2 then 'repeated_obstacle'
         when b.photography_status='needs_refresh' then 'photography_refresh_required'
         else 'healthy'
       end,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then 'urgent'
         when b.last_marketing_at is not null and b.days_without_inquiry>=10 then 'urgent'
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 'high'
         when b.top_rejection_clients>=2 then 'high'
         when b.photography_status='needs_refresh' then 'medium'
         else 'info'
       end,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then
           jsonb_build_object('title','لم يُسجل Reel إنستغرام للعقار خلال 24 ساعة من إدخاله','steps',jsonb_build_array('تحقق هل تم تصوير ونشر Reel للعقار','إذا نُشر، أضف رابط Instagram في التسويق','إذا لم يُنشر، جهز Reel ثم سجّل الرابط بعد النشر'))
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then
           jsonb_build_object('title','مرّت 5 أيام أو أكثر دون استفسار جديد','steps',jsonb_build_array('راجع السعر والغلاف والعنوان والوصف والجمهور','راجع أداء الإعلان أو الـReel قبل اتخاذ قرار إعادة التصوير','نفّذ التعديل المناسب ثم سجّل إعادة الإطلاق ليبدأ قياس 5 أيام جديد'))
         when b.top_rejection_clients>=2 and b.top_rejection_category='price' then
           jsonb_build_object('title','اعتراض سعري متكرر من عملاء مختلفين','steps',jsonb_build_array('راجع اعتراضات السعر المسجلة','قارن السعر بالقيمة الفعلية للعقار قبل مناقشة المالك','لا تخفض السعر تلقائياً؛ اتخذ القرار بعد مراجعة الأدلة'))
         when b.top_rejection_clients>=2 then
           jsonb_build_object('title','عقبة واحدة تكررت من عميلين مختلفين أو أكثر','steps',jsonb_build_array('راجع الملاحظات المسجلة للعملاء','حدد هل المشكلة في العقار أو السعر أو طريقة العرض','نفّذ الإجراء المناسب ثم أعد القياس'))
         when b.photography_status='needs_refresh' then
           jsonb_build_object('title','تم تحديد حاجة فعلية لإعادة التصوير','steps',jsonb_build_array('راجع سبب إعادة التصوير المسجل','جهز اللقطات المطلوبة فقط','سجّل النشر الجديد بعد اكتمال التحديث'))
         else jsonb_build_object('title','الأداء طبيعي حالياً','steps',jsonb_build_array('استمر بالمراقبة'))
       end
from scored b
where (b.photography_status='needs_initial' and b.last_instagram_publish_at is null and coalesce(b.photography_required_at,b.created_at,now())<=now())
   or (b.last_marketing_at is not null and b.days_without_inquiry>=5)
   or b.top_rejection_clients>=2
   or b.photography_status='needs_refresh'
order by
  case
    when b.photography_status='needs_initial' and b.last_instagram_publish_at is null and coalesce(b.photography_required_at,b.created_at,now())<=now() then 1
    when b.last_marketing_at is not null and b.days_without_inquiry>=10 then 2
    when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 3
    when b.top_rejection_clients>=2 then 4
    else 5
  end,
  b.days_without_inquiry desc nulls last,b.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.crm_property_performance(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_branch_key text DEFAULT NULL::text)
 RETURNS TABLE(property_id uuid, property_code text, internal_name text, title text, branch_key text, area text, price numeric, unique_inquirers bigint, inquiry_events bigint, appointments_booked bigint, appointments_confirmed bigint, unique_attendees bigint, total_property_viewings bigint, no_shows bigint, rejected_clients bigint, serious_interest bigint, repeat_visit_clients bigint, negotiations bigint, deposits bigint, closed_deals bigint, inquiry_to_attendance_pct numeric, attendance_to_serious_pct numeric, attendance_to_negotiation_pct numeric, attendance_to_deal_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with props as (
  select p.* from public.crm_properties_access p where p.company_id=(select public.my_company()) and (p_branch_key is null or p.branch_key=p_branch_key)
), pi as (
  select i.property_id,
         count(distinct i.client_id) filter(where i.has_inbound_inquiry=true)::bigint unique_inquirers,
         coalesce(sum(i.inquiry_count) filter(where i.has_inbound_inquiry=true),0)::bigint inquiry_events,
         count(distinct i.client_id) filter(where i.status='negotiation')::bigint pi_negotiations,
         count(distinct i.client_id) filter(where lower(coalesce(i.post_visit_interest,'')) in ('serious','high'))::bigint pi_serious
  from public.property_inquiries i
  where i.company_id=(select public.my_company())
    and (p_start_date is null or i.first_inquiry_at>=p_start_date::timestamptz)
    and (p_end_date is null or i.first_inquiry_at<(p_end_date+1)::timestamptz)
  group by i.property_id
), ap as (
  select x.property_id,count(distinct a.id)::bigint appointments_booked,
         count(distinct a.id) filter(where a.confirmed_at is not null or a.status in ('confirmed','attended'))::bigint appointments_confirmed,
         count(distinct a.client_id) filter(where a.status='attended' and a.attended_at is not null)::bigint unique_attendees,
         count(*) filter(where a.status='attended' and a.attended_at is not null)::bigint total_property_viewings,
         count(distinct a.client_id) filter(where a.status='no_show')::bigint no_shows,
         count(distinct a.client_id) filter(where a.status='attended' and x.interest_level='serious')::bigint ap_serious
  from public.appointment_properties x join public.appointments a on a.id=x.appointment_id and a.company_id=x.company_id
  where x.company_id=(select public.my_company())
    and (p_start_date is null or a.appointment_at>=p_start_date::timestamptz)
    and (p_end_date is null or a.appointment_at<(p_end_date+1)::timestamptz)
  group by x.property_id
), repeats as (
  select property_id,count(*)::bigint repeat_visit_clients from (
    select x.property_id,a.client_id from public.appointment_properties x join public.appointments a on a.id=x.appointment_id and a.company_id=x.company_id
    where x.company_id=(select public.my_company()) and a.status='attended' and a.attended_at is not null
      and (p_start_date is null or a.appointment_at>=p_start_date::timestamptz) and (p_end_date is null or a.appointment_at<(p_end_date+1)::timestamptz)
    group by x.property_id,a.client_id having count(*)>1
  ) q group by property_id
), rej as (
  select property_id,count(distinct client_id)::bigint rejected_clients from public.property_rejection_reasons
  where company_id=(select public.my_company()) and (p_start_date is null or created_at>=p_start_date::timestamptz) and (p_end_date is null or created_at<(p_end_date+1)::timestamptz)
  group by property_id
), dl as (
  select d.property_id,count(distinct d.id) filter(where d.stage in ('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected'))::bigint negotiations,
         count(distinct d.id) filter(where d.stage in ('closed','commission_collected'))::bigint closed_deals
  from public.crm_deals_access d where d.company_id=(select public.my_company()) and (p_start_date is null or d.created_at>=p_start_date::timestamptz) and (p_end_date is null or d.created_at<(p_end_date+1)::timestamptz)
  group by d.property_id
), dp as (
  select d.property_id,count(distinct x.id)::bigint deposits from public.deposits x join public.crm_deals_access d on d.id=x.deal_id and d.company_id=x.company_id
  where x.company_id=(select public.my_company()) and x.status not in ('refunded','forfeited') and (p_start_date is null or x.payment_date>=p_start_date) and (p_end_date is null or x.payment_date<=p_end_date)
  group by d.property_id
)
select p.id,p.property_code,p.internal_name,p.title,p.branch_key,p.area,p.price,coalesce(pi.unique_inquirers,0),coalesce(pi.inquiry_events,0),
       coalesce(ap.appointments_booked,0),coalesce(ap.appointments_confirmed,0),coalesce(ap.unique_attendees,0),coalesce(ap.total_property_viewings,0),coalesce(ap.no_shows,0),
       coalesce(rej.rejected_clients,0),greatest(coalesce(pi.pi_serious,0),coalesce(ap.ap_serious,0)),coalesce(repeats.repeat_visit_clients,0),
       greatest(coalesce(pi.pi_negotiations,0),coalesce(dl.negotiations,0)),coalesce(dp.deposits,0),coalesce(dl.closed_deals,0),
       case when coalesce(pi.unique_inquirers,0)=0 then null else round(coalesce(ap.unique_attendees,0)::numeric*100/pi.unique_inquirers,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(greatest(coalesce(pi.pi_serious,0),coalesce(ap.ap_serious,0))::numeric*100/ap.unique_attendees,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(greatest(coalesce(pi.pi_negotiations,0),coalesce(dl.negotiations,0))::numeric*100/ap.unique_attendees,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(coalesce(dl.closed_deals,0)::numeric*100/ap.unique_attendees,2) end
from props p left join pi on pi.property_id=p.id left join ap on ap.property_id=p.id left join repeats on repeats.property_id=p.id left join rej on rej.property_id=p.id left join dl on dl.property_id=p.id left join dp on dp.property_id=p.id
order by coalesce(ap.unique_attendees,0) desc,coalesce(pi.unique_inquirers,0) desc,p.created_at desc;
$function$;
