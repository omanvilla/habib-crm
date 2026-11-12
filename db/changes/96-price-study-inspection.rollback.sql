-- Rollback of SQL96: the queue Claude reads goes back to its SQL94 columns (no «inspected» / «inspected_at»), the inspection
-- functions and the two bucket policies go. The table is dropped only when it is empty: saved inspections are Ahmed's notes,
-- so with rows in it the table stays (owner-only, read by nothing). Photos already uploaded stay in the private bucket.
-- Re-pin price-study to 30a1913 as well (its «sign_inspection» action reads the table).
SET LOCAL lock_timeout = '10s';

DROP FUNCTION IF EXISTS public.crm_price_study_inspection(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_inspection_save(uuid, text, date, text[]);
DROP POLICY IF EXISTS crm_price_study_inspection_owner_insert ON storage.objects;
DROP POLICY IF EXISTS crm_price_study_inspection_owner_delete ON storage.objects;

DROP FUNCTION IF EXISTS public.crm_price_study_queue();
CREATE FUNCTION public.crm_price_study_queue()
 RETURNS TABLE (task_id uuid, state text, reject_note text, files_error text, next_version integer, task_title text, task_notes text,
                task_created_at timestamptz, branch text, conversation_id uuid, owner_name text, property_kind text, kind_raw text,
                area text, wilayat text, owner_price numeric, land_size numeric, built_size numeric, plot_no text, offer_notes text,
                owner_lead_id uuid, chat_summary text, docs_saved integer, docs_not_saved integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
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
             and not exists (select 1 from public.owner_price_study_docs d where d.message_id = m.id and d.status = 'saved'))
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
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and (s.id is null or s.status in ('rejected', 'files_failed'))
   order by t.created_at
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_queue() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF to_regclass('public.owner_price_study_inspections') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.owner_price_study_inspections) THEN
    DROP TABLE public.owner_price_study_inspections;
  END IF;
END $$;
