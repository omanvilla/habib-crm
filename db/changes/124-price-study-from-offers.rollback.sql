-- Rollback SQL124: the queue, the hand-in, the alert brief and crm_sync_owner_leads go back to their SQL96 / SQL99 / SQL94
-- bodies, the job, the twin trigger and the new functions go. Tasks opened by the job stay (they are real tasks); the
-- column tasks.owner_lead_id is dropped last (the queue then finds the offer by the chat again).
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_open_tasks') THEN PERFORM cron.unschedule('owner_price_study_open_tasks'); END IF;
END $$;
DROP TRIGGER IF EXISTS crm_owner_lead_take_twins ON public.owner_leads;
DROP FUNCTION IF EXISTS crm_repair_private.owner_lead_take_twins();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_open_tasks();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_title(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_buyers(uuid);

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
       where o.company_id = t.company_id and (o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
    left join lateral (
      select x.* from public.owner_price_studies x where x.task_id = t.id and x.status <> 'cancelled'
       order by x.version desc limit 1) s on true
    left join public.owner_price_study_inspections i on i.task_id = t.id
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and (s.id is null or s.status in ('rejected', 'files_failed'))
   order by t.created_at
$function$;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text)'::regprocedure);
  d := replace(d, 'select x.id, x.company_id, x.client_id, x.title, x.done, x.owner_lead_id into t', 'select x.id, x.company_id, x.client_id, x.title, x.done into t');
  d := replace(d, 'where o.company_id = t.company_id and (o.id = t.owner_lead_id or o.conversation_id = v_conv.id or o.client_id = t.client_id)',
                  'where o.company_id = t.company_id and (o.conversation_id = v_conv.id or o.client_id = t.client_id)');
  d := replace(d, 'order by (o.id = t.owner_lead_id) desc nulls last, (o.conversation_id = v_conv.id) desc nulls last', 'order by (o.conversation_id = v_conv.id) desc nulls last');
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_brief(p_task_id uuid)
 RETURNS TABLE (task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id, t.company_id, c.route_key,
         crm_repair_private.price_study_kind(l.kind, l.built_size), l.kind, l.area, l.wilayat
    from public.tasks t
    left join public.whatsapp_conversations c on c.id = crm_repair_private.price_study_conversation(t.id)
    left join lateral (
      select o.* from public.owner_leads o
       where o.company_id = t.company_id and (o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
   where t.id = p_task_id
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_brief(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_sync_owner_leads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with src as (
    select r.id, r.company_id, r.client_id, r.property_type, coalesce(r.preferred_area, r.preferred_areas[1]) area, r.wilayat,
      crm_money(coalesce(r.budget_max, r.budget_min)) price, r.land_size_min, r.built_size_min, r.notes, r.created_at,
      (select w.id from whatsapp_conversations w where w.client_id=r.client_id order by w.last_message_at desc nulls last limit 1) conv,
      substring(coalesce(r.notes,'') from 'رقم القطعة: *([0-9٠-٩]+)') plot
    from client_requests r join clients c on c.id=r.client_id
    where r.request_type='seller' and r.status='active' and r.created_at>='2025-01-01'
      and (coalesce(r.property_type,'')<>'' or coalesce(r.preferred_area,r.wilayat) is not null)
      and not exists (select 1 from owner_leads o where o.client_id=r.client_id and o.source_request_id is null and o.kind is not distinct from crm_owner_kind(r.property_type))
      and not exists (select 1 from company_lead_routes x where regexp_replace(coalesce(x.whatsapp_number,''),'\D','','g')=regexp_replace(coalesce(c.phone_normalized,c.phone,''),'\D','','g') and coalesce(c.phone,'')<>'')
  ), up as (
    insert into owner_leads(company_id, client_id, conversation_id, kind, area, wilayat, price, land_size, built_size, notes, status, source_request_id, plot_no, created_at, updated_at)
    select company_id, client_id, conv, crm_owner_kind(property_type), area, wilayat, price, land_size_min, built_size_min, left(notes,1000), 'open', id, plot, created_at, now() from src
    on conflict (source_request_id) do update set kind=excluded.kind, area=excluded.area, wilayat=excluded.wilayat, price=coalesce(excluded.price, owner_leads.price),
      land_size=coalesce(excluded.land_size, owner_leads.land_size), built_size=coalesce(excluded.built_size, owner_leads.built_size),
      conversation_id=coalesce(owner_leads.conversation_id, excluded.conversation_id), plot_no=coalesce(excluded.plot_no, owner_leads.plot_no), updated_at=now()
    returning 1)
  select count(*) into n from up;
  update owner_leads l set status='listed', updated_at=now() where l.status in ('open','studied') and exists (
    select 1 from properties p join owners o on o.id=p.owner_id join clients c on c.id=l.client_id
    where p.status in ('available','reserved') and regexp_replace(coalesce(o.phone,''),'\D','','g')<>''
      and right(regexp_replace(o.phone,'\D','','g'),8)=right(regexp_replace(coalesce(c.phone_normalized,c.phone,''),'\D','','g'),8));
  update owner_leads l set status='closed', updated_at=now() from client_requests r where r.id=l.source_request_id and r.status<>'active' and l.status in ('open','studied');
  return n;
end $function$;

DROP FUNCTION IF EXISTS crm_repair_private.owner_kind_norm(text);
DROP INDEX IF EXISTS public.tasks_owner_lead_id_idx;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS owner_lead_id;
