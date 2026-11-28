-- Rollback of SQL170: the queue and the unpriced alert as they were (SQL145 / SQL96 shape).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_price_study_queue()
 RETURNS TABLE(task_id uuid, state text, reject_note text, files_error text, next_version integer, task_title text, task_notes text, task_created_at timestamp with time zone, branch text, conversation_id uuid, owner_name text, property_kind text, kind_raw text, area text, wilayat text, owner_price numeric, land_size numeric, built_size numeric, plot_no text, offer_notes text, owner_lead_id uuid, chat_summary text, docs_saved integer, docs_not_saved integer, inspected boolean, inspected_at date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id,
         case when s.id is null then 'new' when s.status = 'rejected' then 'rejected' else 'files_failed' end,
         case when s.status = 'rejected' then s.reject_note end,
         case when s.status = 'files_failed' then s.files_error end,
         coalesce(s.version, 0) + 1,
         t.title, t.notes, t.created_at, c.route_key, c.id,
         coalesce(nullif(cl.name, ''), c.customer_name),
         crm_repair_private.price_study_kind(l.kind, l.built_size), l.kind,
         l.area, l.wilayat, l.price, l.land_size, l.built_size, l.plot_no, l.notes, l.id,
         coalesce(c.agent_note, c.ai_summary),
         (select count(*)::int from public.owner_price_study_docs d where d.conversation_id = c.id and d.status = 'saved'),
         (select count(*)::int from public.whatsapp_messages m
           where m.conversation_id = c.id and m.direction = 'inbound' and m.message_type in ('image', 'document', 'video') and m.media_id is not null
             and not exists (select 1 from public.owner_price_study_docs d where d.message_id = m.id and d.status = 'saved')),
         (i.task_id is not null), i.inspected_at
    from public.tasks t
    left join public.clients cl on cl.id = t.client_id
    left join public.whatsapp_conversations c on c.id = crm_repair_private.price_study_conversation(t.id)
    left join lateral (
      select o.* from public.owner_leads o
       where o.company_id = t.company_id and (o.id = t.owner_lead_id or o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.id = t.owner_lead_id) desc nulls last, (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
    left join lateral (
      select x.* from public.owner_price_studies x where x.task_id = t.id and x.status <> 'cancelled'
       order by x.version desc limit 1) s on true
    left join public.owner_price_study_inspections i on i.task_id = t.id
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and (s.id is null or s.status in ('rejected', 'files_failed'))
   order by (t.priority = 'high') desc, t.created_at
$function$;

CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()
 RETURNS TABLE(task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text, waited_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.task_id, b.company_id, b.branch, b.property_kind, b.kind_raw, b.area, b.wilayat,
         (extract(epoch from (now() - t.created_at)) / 60)::integer
    from public.tasks t
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and t.created_at >= greatest(timestamptz '2026-11-13 00:00:00+04', now() - interval '3 days')
     and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)
     and now() >= crm_repair_private.price_study_first_run(
                    crm_repair_private.price_study_first_run(greatest(t.created_at, timestamptz '2026-11-18 14:30:00+04'))) + interval '2 hours'
     and (now() at time zone 'Asia/Muscat')::time >= time '05:00'
     and (now() at time zone 'Asia/Muscat')::time < time '21:15'
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = t.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason like 'price_study_unpriced%'
                        and e.created_at >= ((now() at time zone 'Asia/Muscat')::date::timestamp at time zone 'Asia/Muscat'))
   order by t.created_at
   limit 40
$function$;
