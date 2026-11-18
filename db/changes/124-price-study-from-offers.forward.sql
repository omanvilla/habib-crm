-- SQL124 (18 Nov 2026, Ahmed's check of the CRM, item 1: «التسعير الآلي»).
-- Why an owner offer from a chat did not open a «دراسة سعر» task: the reply agent opens the task only when ITS handoff reason
-- starts with «دراسة سعر:» (whatsapp-reply-agent, «an owner sent everything»). The model often writes a plain reason instead
-- («المالك أرسل بيانات فيلا جديدة …», Nasser Al-Mushaifri 8 Nov), so the offer is saved and no task opens. It also opens one
-- task per client, so an owner with two properties never gets the second one. And every offer the agent saved had a twin
-- from the client's seller request (crm_sync_owner_leads compared «villa» with «فيلا» and found no match), so the same
-- property was listed twice in «عروض الملاك» and matched twice with the same buyers.
-- What this does (the reply agent and the price-study queue columns are not changed):
--   1. tasks.owner_lead_id: a price study task names the offer it prices. The queue, the hand-in and the alerts take that
--      offer first (same columns, same names: Ahmed's rule of 13 Nov), so two properties of one owner get two tasks.
--   2. the queue gives priority 'high' tasks first (Ahmed: Nasser's villas before any other offer).
--   3. a job every 10 minutes opens the task the agent did not: every open offer from a Barka / Muscat chat, saved from now
--      on, with a type, a place and a size, and no task of its own, gets «دراسة سعر: …» (Ahmed's list, user_id the owner),
--      and the owner's photos / documents are copied for Claude (price-study save_docs). Older offers are not touched here:
--      Ahmed decides about them (the count is in the report).
--   4. the seller-request twin: crm_sync_owner_leads compares the type in both languages, and an offer the agent saves from
--      now on takes over a request twin saved from now on (its buyer matches move to the agent's offer, the twin closes with
--      the note «مكرر»). Twins saved before today are not closed here (Ahmed's rule: he sees the list first).
--   5. crm_price_study_buyers(study): active buyers for the property at the study's asking price, for the «📊 دراسة سعر
--      جاهزة» message (price-study v8) and the screen. Owner or backend only.
-- Rollback: 124-price-study-from-offers.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF to_regprocedure('crm_repair_private.price_study_conversation(uuid)') IS NULL
     OR to_regprocedure('crm_repair_private.price_study_call(jsonb, integer)') IS NULL
     OR to_regprocedure('crm_repair_private.price_study_kind(text, numeric)') IS NULL THEN
    RAISE EXCEPTION 'SQL124 refused: the SQL94 price study functions are missing';
  END IF;
  IF md5(pg_get_functiondef('public.crm_price_study_queue()'::regprocedure)) <> 'c218b1df07e1e7724da11067f708f8dd'
     OR md5(pg_get_functiondef('public.crm_sync_owner_leads()'::regprocedure)) <> '24d97e056ff145ddb309f3a72de3c42c' THEN
    RAISE EXCEPTION 'SQL124 refused: crm_price_study_queue or crm_sync_owner_leads changed since it was written';
  END IF;
END $$;

-- 1. the offer a task prices
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS owner_lead_id uuid REFERENCES public.owner_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_owner_lead_id_idx ON public.tasks (owner_lead_id) WHERE owner_lead_id IS NOT NULL;

-- the type of an offer or a request in one word, Arabic or English («فيلا» = «villa» = «house»)
CREATE OR REPLACE FUNCTION crm_repair_private.owner_kind_norm(k text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when k is null or btrim(k) = '' then null
    when k ~* '^\s*(land|plot)' or k ~ '^\s*(أرض|ارض|قطع)' then 'land'
    when k ~* '^\s*farm' or k ~ '^\s*مزرع' then 'farm'
    when k ~* '^\s*(villa|house|twin|townhouse|duplex)' or k ~ '^\s*(فيل|فل|بيت|منزل|توين|تاون|دوبلكس|دبلكس)' then 'villa'
    when k ~* '^\s*(building|residential_building)' or k ~ '^\s*(عمار|بناي|مبنى)' then 'building'
    when k ~* '^\s*(apartment|penthouse|flat|studio)' or k ~ '^\s*(شق|ستوديو)' then 'apartment'
    when k ~* '^\s*(shop|commercial|other)' or k ~ '^\s*(محل|معرض)' then 'shop'
    when k ~* '^\s*(chalet|rest)' or k ~ '^\s*(شاليه|استراح)' then 'chalet'
    else lower(btrim(k)) end
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.owner_kind_norm(text) FROM PUBLIC, anon, authenticated;

-- 2. the queue: the task's own offer first, priority 'high' first. Same columns, names and order as SQL96.
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

-- the hand-in records the task's own offer
DO $$
DECLARE d text; n integer;
BEGIN
  d := pg_get_functiondef('public.crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text)'::regprocedure);
  n := (length(d) - length(replace(d, 'order by (o.conversation_id = v_conv.id) desc nulls last', ''))) / length('order by (o.conversation_id = v_conv.id) desc nulls last');
  IF n <> 1 THEN RAISE EXCEPTION 'SQL124 refused: crm_price_study_submit changed (% matches)', n; END IF;
  d := replace(d, 'select x.id, x.company_id, x.client_id, x.title, x.done into t', 'select x.id, x.company_id, x.client_id, x.title, x.done, x.owner_lead_id into t');
  d := replace(d, 'where o.company_id = t.company_id and (o.conversation_id = v_conv.id or o.client_id = t.client_id)',
                  'where o.company_id = t.company_id and (o.id = t.owner_lead_id or o.conversation_id = v_conv.id or o.client_id = t.client_id)');
  d := replace(d, 'order by (o.conversation_id = v_conv.id) desc nulls last', 'order by (o.id = t.owner_lead_id) desc nulls last, (o.conversation_id = v_conv.id) desc nulls last');
  EXECUTE d;
END $$;

-- the alerts (SQL99) describe the same offer as the queue
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
       where o.company_id = t.company_id and (o.id = t.owner_lead_id or o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.id = t.owner_lead_id) desc nulls last, (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
   where t.id = p_task_id
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_brief(uuid) FROM PUBLIC, anon, authenticated;

-- 4. the seller-request twin is not saved again when the agent's offer of the same type exists (both languages)
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
      and not exists (select 1 from owner_leads o where o.client_id=r.client_id and o.source_request_id is null
                        and crm_repair_private.owner_kind_norm(o.kind) is not distinct from crm_repair_private.owner_kind_norm(r.property_type))
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

-- 4. an offer the agent saves takes over a request twin saved from today (the twin's buyer matches move, the twin closes)
CREATE OR REPLACE FUNCTION crm_repair_private.owner_lead_take_twins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record;
BEGIN
  IF NEW.source_request_id IS NOT NULL OR NEW.client_id IS NULL OR NEW.kind IS NULL THEN RETURN NULL; END IF;
  FOR r IN
    SELECT o.id, o.notes FROM public.owner_leads o
     WHERE o.client_id = NEW.client_id AND o.id <> NEW.id AND o.source_request_id IS NOT NULL AND o.status = 'open'
       AND o.created_at >= timestamptz '2026-11-18 00:00:00+04'
       AND crm_repair_private.owner_kind_norm(o.kind) = crm_repair_private.owner_kind_norm(NEW.kind)
  LOOP
    INSERT INTO public.owner_lead_matches (lead_id, request_id, created_at)
      SELECT NEW.id, m.request_id, m.created_at FROM public.owner_lead_matches m WHERE m.lead_id = r.id
      ON CONFLICT DO NOTHING;
    UPDATE public.owner_leads SET status = 'closed', updated_at = now(),
           notes = left(concat_ws(E'\n', r.notes, 'مكرر: نفس العرض محفوظ من المحادثة (' || NEW.id::text || ')'), 2000)
     WHERE id = r.id AND status = 'open';
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.owner_lead_take_twins() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_owner_lead_take_twins ON public.owner_leads;
CREATE TRIGGER crm_owner_lead_take_twins AFTER INSERT ON public.owner_leads
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.owner_lead_take_twins();

-- the title of a task opened for an offer: «دراسة سعر: فيلا في الرميس · أرض 377 م² · بناء 311 م² · 71 ألف»
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_title(p_lead uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select left(concat_ws(' · ',
           'دراسة سعر: ' || case crm_repair_private.owner_kind_norm(l.kind)
              when 'land' then 'أرض' when 'villa' then 'فيلا' when 'farm' then 'مزرعة' when 'building' then 'عمارة'
              when 'apartment' then 'شقة' when 'shop' then 'محل' when 'chalet' then 'استراحة' else coalesce(l.kind, 'عقار') end
              || coalesce(' في ' || nullif(concat_ws('، ', nullif(l.area, ''), nullif(l.wilayat, l.area)), ''), ''),
           case when l.land_size > 0 then 'أرض ' || trim(to_char(l.land_size, 'FM999G999D#')) || ' م²' end,
           case when l.built_size > 0 then 'بناء ' || trim(to_char(l.built_size, 'FM999G999D#')) || ' م²' end,
           case when public.crm_money(l.price) is not null then 'السعر المطلوب ' || trim(to_char(public.crm_money(l.price), 'FM999G999G999')) end), 200)
    from public.owner_leads l where l.id = p_lead
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_title(uuid) FROM PUBLIC, anon, authenticated;

-- 3. every 10 minutes: tasks the agent opened name their offer, and an offer with no task gets one
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_open_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l record; v_owner uuid; v_task uuid; v_conv uuid; n integer := 0;
BEGIN
  -- the agent's tasks (no offer named): the offer the queue already showed for them
  UPDATE public.tasks t SET owner_lead_id = (
      SELECT o.id FROM public.owner_leads o
       WHERE o.company_id = t.company_id AND (o.conversation_id = crm_repair_private.price_study_conversation(t.id) OR o.client_id = t.client_id)
       ORDER BY (o.conversation_id = crm_repair_private.price_study_conversation(t.id)) DESC NULLS LAST, (o.source_request_id IS NULL) DESC, o.created_at DESC
       LIMIT 1)
   WHERE t.title ILIKE 'دراسة سعر%' AND NOT coalesce(t.done, false) AND t.owner_lead_id IS NULL AND t.client_id IS NOT NULL;

  FOR l IN
    SELECT o.* FROM public.owner_leads o
     WHERE o.status = 'open'
       AND o.created_at >= timestamptz '2026-11-18 00:00:00+04'
       AND o.created_at < now() - interval '10 minutes'          -- the agent closes a declined offer in the same run
       AND o.client_id IS NOT NULL
       AND crm_repair_private.owner_kind_norm(o.kind) IS NOT NULL
       AND coalesce(nullif(o.area, ''), nullif(o.wilayat, '')) IS NOT NULL
       AND (coalesce(o.land_size, 0) > 0 OR coalesce(o.built_size, 0) > 0)
       AND EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.client_id = o.client_id AND c.company_id = o.company_id AND c.route_key IN ('barka', 'muscat'))
       -- a request twin waits for the agent's offer of the same type (that one gets the task)
       AND NOT (o.source_request_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.owner_leads x WHERE x.client_id = o.client_id AND x.id <> o.id AND x.source_request_id IS NULL
                AND x.status IN ('open', 'studied') AND crm_repair_private.owner_kind_norm(x.kind) = crm_repair_private.owner_kind_norm(o.kind)))
       AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.owner_lead_id = o.id AND t.title ILIKE 'دراسة سعر%')
       AND NOT EXISTS (SELECT 1 FROM public.owner_price_studies s WHERE s.owner_lead_id = o.id)
       -- the same property already has a task through another offer of this owner (same type, same size, same price)
       AND NOT EXISTS (SELECT 1 FROM public.tasks t JOIN public.owner_leads x ON x.id = t.owner_lead_id
                        WHERE t.client_id = o.client_id AND t.title ILIKE 'دراسة سعر%'
                          AND (NOT coalesce(t.done, false) OR t.completed_at > now() - interval '30 days')
                          AND crm_repair_private.owner_kind_norm(x.kind) = crm_repair_private.owner_kind_norm(o.kind)
                          AND coalesce(x.land_size, 0) = coalesce(o.land_size, 0) AND coalesce(x.built_size, 0) = coalesce(o.built_size, 0)
                          AND coalesce(public.crm_money(x.price), 0) = coalesce(public.crm_money(o.price), 0))
     ORDER BY o.created_at
     LIMIT 10
  LOOP
    SELECT p.id INTO v_owner FROM public.profiles p WHERE p.company_id = l.company_id AND p.role = 'owner' AND p.is_active LIMIT 1;
    INSERT INTO public.tasks (company_id, user_id, client_id, title, notes, due_date, priority, done, owner_lead_id)
      VALUES (l.company_id, v_owner, l.client_id, crm_repair_private.price_study_title(l.id), left(l.notes, 1000),
              ((now() at time zone 'Asia/Muscat')::date + 1), 'medium', false, l.id)
      RETURNING id INTO v_task;
    n := n + 1;
    v_conv := crm_repair_private.price_study_conversation(v_task);
    IF v_conv IS NOT NULL THEN
      BEGIN
        PERFORM crm_repair_private.price_study_call(jsonb_build_object('action', 'save_docs', 'conversation_id', v_conv), 60000);
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_open_tasks() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_open_tasks') THEN PERFORM cron.unschedule('owner_price_study_open_tasks'); END IF;
END $$;
SELECT cron.schedule('owner_price_study_open_tasks', '4-54/10 * * * *', $job$ select crm_repair_private.price_study_open_tasks(); $job$);

-- 5. buyers for a studied property at the study's asking price (the owner's price before a study): same type in either
-- language, the place word of crm_match_owner_leads, budget 85% to 130% of the price, active in the last 90 days, one row per client
CREATE OR REPLACE FUNCTION public.crm_price_study_buyers(p_study_id uuid)
 RETURNS TABLE (client_id uuid, name text, phone text, budget numeric, route text, request_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s record; l record; v_price numeric; v_tok text; v_kind text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT EXISTS (
       SELECT 1 FROM public.profiles p JOIN public.owner_price_studies x ON x.company_id = p.company_id
        WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active AND x.id = p_study_id) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;
  SELECT x.* INTO s FROM public.owner_price_studies x WHERE x.id = p_study_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT o.* INTO l FROM public.owner_leads o
   WHERE o.id = coalesce(s.owner_lead_id, (SELECT t.owner_lead_id FROM public.tasks t WHERE t.id = s.task_id));
  IF NOT FOUND THEN RETURN; END IF;
  v_price := coalesce(public.crm_money(s.asking_price), public.crm_money(l.price));
  v_kind := crm_repair_private.owner_kind_norm(l.kind);
  v_tok := public.crm_area_token(l.area);
  IF v_kind IS NULL OR (v_tok IS NULL AND l.wilayat IS NULL) THEN RETURN; END IF;
  RETURN QUERY
    SELECT DISTINCT ON (q.client_id) q.client_id, coalesce(nullif(c.name, ''), 'عميل'), coalesce(c.phone_normalized, c.phone),
           public.crm_money(q.budget_max), c.lead_route, q.id
      FROM public.client_requests q
      JOIN public.clients c ON c.id = q.client_id
     WHERE q.company_id = l.company_id AND q.status = 'active' AND q.request_type = 'buyer'
       AND q.updated_at > now() - interval '90 days' AND q.client_id IS DISTINCT FROM l.client_id
       AND public.crm_money(q.budget_max) IS NOT NULL
       AND NOT coalesce(c.archived, false)
       AND (crm_repair_private.owner_kind_norm(q.property_type) = v_kind
            OR EXISTS (SELECT 1 FROM unnest(coalesce(q.property_types, '{}')) t WHERE crm_repair_private.owner_kind_norm(t) = v_kind))
       AND (v_price IS NULL OR public.crm_money(q.budget_max) BETWEEN v_price * 0.85 AND v_price * 1.3)
       AND (CASE WHEN v_tok IS NOT NULL THEN
              (q.preferred_area ILIKE '%' || v_tok || '%' OR EXISTS (SELECT 1 FROM unnest(coalesce(q.preferred_areas, '{}')) a WHERE a ILIKE '%' || v_tok || '%'))
            ELSE (q.wilayat ILIKE '%' || l.wilayat || '%' AND coalesce(q.preferred_area, '') = '') END)
     ORDER BY q.client_id, q.updated_at DESC;
END $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_buyers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_study_buyers(uuid) TO authenticated, service_role;
