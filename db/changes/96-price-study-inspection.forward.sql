-- SQL96 (12 Nov 2026, Ahmed): «معاينة المكتب» on a «دراسة سعر» task. Ahmed visits the property, writes (or dictates) what he saw
-- and uploads up to 20 photos from his phone, with the date of the visit. The note and the photos are owner-only (table RLS
-- and bucket policies; no staff policy) and never reach the owner of the property. Claude (pricing projects) reads them
-- through crm_price_study_inspection (6-hour photo links signed by the edge function price-study) and sees «inspected» and
-- «inspected_at» at the end of crm_price_study_queue. «أعد الدراسة بعد المعاينة» on the screen is the existing rejection
-- (crm_price_study_decide) with the note «معاينة المكتب»; nothing about approving or sending changes.
-- Rollback: 96-price-study-inspection.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_price_study_queue()'::regprocedure)) <> 'e57dd2e18c99365cd6163b492ba90dce' THEN
    RAISE EXCEPTION 'SQL96 refused: crm_price_study_queue changed since 12 Nov 2026';
  END IF;
END $$;

-- 1. one inspection per task (owner only)
CREATE TABLE IF NOT EXISTS public.owner_price_study_inspections (
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  note text,
  inspected_at date NOT NULL,
  photos text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_price_study_inspections_photos_chk CHECK (cardinality(photos) <= 20)
);

ALTER TABLE public.owner_price_study_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_price_study_inspections_owner_read ON public.owner_price_study_inspections;
CREATE POLICY owner_price_study_inspections_owner_read ON public.owner_price_study_inspections FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.owner_price_study_inspections FROM anon, authenticated;
GRANT SELECT ON public.owner_price_study_inspections TO authenticated;
GRANT ALL ON public.owner_price_study_inspections TO service_role;

-- 2. the photos live in the private bucket «price-studies» under inspections/<task>/<uuid>.<ext>. The owner already reads the
-- whole bucket (SQL94); he may add and remove files under inspections/ only. Nobody else has a policy.
DROP POLICY IF EXISTS crm_price_study_inspection_owner_insert ON storage.objects;
CREATE POLICY crm_price_study_inspection_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) = 'owner');
DROP POLICY IF EXISTS crm_price_study_inspection_owner_delete ON storage.objects;
CREATE POLICY crm_price_study_inspection_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) = 'owner');

-- 3. the screen saves the whole inspection (owner only). An empty note with no photo removes it.
CREATE OR REPLACE FUNCTION public.crm_price_study_inspection_save(p_task_id uuid, p_note text, p_inspected_at date, p_photos text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t record; v_note text; v_photos text[]; v_date date; v_today date := (now() at time zone 'Asia/Muscat')::date; v_path text;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
  select x.id, x.company_id, x.title into t from public.tasks x where x.id = p_task_id and x.company_id = public.my_company();
  if not found then raise exception 'task_not_found'; end if;
  if t.title not ilike 'دراسة سعر%' then raise exception 'not_a_price_study_task'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if length(v_note) > 6000 then raise exception 'note_longer_than_6000_characters'; end if;
  select coalesce(array_agg(u.p order by u.n), '{}') into v_photos
    from (select p, min(n) as n from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as a(p, n) group by p) u;
  if cardinality(v_photos) > 20 then raise exception 'at_most_20_photos'; end if;
  foreach v_path in array v_photos loop
    if v_path !~ ('^inspections/' || p_task_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then raise exception 'photo_path_not_of_this_task'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'price-studies' and o.name = v_path) then raise exception 'photo_not_uploaded'; end if;
  end loop;
  if v_note is null and cardinality(v_photos) = 0 then
    delete from public.owner_price_study_inspections i where i.task_id = p_task_id;
    return jsonb_build_object('ok', true, 'inspected', false, 'task_id', p_task_id);
  end if;
  v_date := coalesce(p_inspected_at, v_today);
  if v_date > v_today + 1 or v_date < v_today - 3650 then raise exception 'inspection_date_out_of_range'; end if;
  insert into public.owner_price_study_inspections as i (task_id, company_id, note, inspected_at, photos, created_by)
    values (p_task_id, t.company_id, v_note, v_date, v_photos, (select auth.uid()))
    on conflict (task_id) do update set note = excluded.note, inspected_at = excluded.inspected_at, photos = excluded.photos, updated_at = now();
  return jsonb_build_object('ok', true, 'inspected', true, 'task_id', p_task_id, 'note', v_note, 'inspected_at', v_date, 'photos', to_jsonb(v_photos));
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_inspection_save(uuid, text, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_study_inspection_save(uuid, text, date, text[]) TO authenticated;

-- 4. for Claude: the inspection of a task. No row when the office has not inspected it. The photo links work for 6 hours.
CREATE OR REPLACE FUNCTION public.crm_price_study_inspection(p_task_id uuid)
 RETURNS TABLE (inspected_at date, note text, photos integer, photo_urls text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i record; v_secret text; r record; j jsonb;
begin
  select x.inspected_at as d, x.note as n, x.photos as p into i from public.owner_price_study_inspections x where x.task_id = p_task_id;
  if not found then return; end if;
  if cardinality(i.p) = 0 then
    return query select i.d, i.n, 0, '{}'::text[];
    return;
  end if;
  select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name = 'crm_reply_agent';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
  select h.status as http_status, h.content as http_content into r
    from extensions.http(('POST', 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/price-study',
           ARRAY[extensions.http_header('x-crm-agent', v_secret)], 'application/json',
           jsonb_build_object('action', 'sign_inspection', 'task_id', p_task_id)::text)::extensions.http_request) h;
  if r.http_status <> 200 then raise exception 'sign_failed: % %', r.http_status, left(r.http_content, 200); end if;
  j := r.http_content::jsonb;
  return query select i.d, i.n, cardinality(i.p),
    array(select u.v from jsonb_array_elements_text(coalesce(j -> 'photos', '[]'::jsonb)) with ordinality as u(v, n) order by u.n);
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_inspection(uuid) FROM PUBLIC, anon, authenticated;

-- 5. the queue Claude reads: the same columns in the same order, then «inspected» and «inspected_at» at the end
DROP FUNCTION public.crm_price_study_queue();
CREATE FUNCTION public.crm_price_study_queue()
 RETURNS TABLE (task_id uuid, state text, reject_note text, files_error text, next_version integer, task_title text, task_notes text,
                task_created_at timestamptz, branch text, conversation_id uuid, owner_name text, property_kind text, kind_raw text,
                area text, wilayat text, owner_price numeric, land_size numeric, built_size numeric, plot_no text, offer_notes text,
                owner_lead_id uuid, chat_summary text, docs_saved integer, docs_not_saved integer, inspected boolean, inspected_at date)
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
REVOKE ALL ON FUNCTION public.crm_price_study_queue() FROM PUBLIC, anon, authenticated;
