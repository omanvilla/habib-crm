-- SQL162 (27 Nov 2026, Ahmed: «نعم نروح على نصيحتك»): the first two hires of the company office.
--   1. «صائد العقارات» (property hunter): the daily cloud check of the market sheet hands the newest Barka ads to
--      crm_repair_private.hunt_add(rows). It keeps only direct sellers (a person, not an office, and a number that is not
--      on many ads) of ready villas / houses at 55,000-70,000 OMR whose number is not already an owner offer in the CRM, and
--      stores them in public.crm_hunt_leads. They appear in Maram's «اتصل بعدهم» list (crm_call_next) until somebody calls
--      the number, or 21 days pass without a new ad. Nothing is sent to anybody: a call list only.
--   2. «مسؤول الإحالات» (referrals): a daily cron (Sunday-Thursday 8:15 Muscat) gives Maram at most 3 tasks a day
--      «اطلب إحالة» for buyers and owners of deals whose commission was collected at least 30 days ago: once every 180
--      days per number (every 60 days for a developer / an owner who sold twice or more through us), newest deals first.
--      A buyer on Ahmed's private line goes to Ahmed. Archived or «stop follow-up» clients are skipped.
--   3. crm_office_snapshot(): the two new desks in «المكتب» (owner / manager only), no money as before.
-- Rollback: 162-hunter-referrals.rollback.sql

-- ---------------- 1. property hunter ----------------
CREATE TABLE IF NOT EXISTS public.crm_hunt_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone8 text NOT NULL,
  phone text NOT NULL,
  name text,
  kind text,
  wilayat text,
  area text,
  price numeric,
  land_size numeric,
  built_size numeric,
  link text,
  source text,
  listings jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'broker')),
  first_seen date,
  last_new_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, phone8)
);
ALTER TABLE public.crm_hunt_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_hunt_leads FROM PUBLIC, anon;
GRANT SELECT ON public.crm_hunt_leads TO authenticated;
DROP POLICY IF EXISTS crm_hunt_leads_select_staff ON public.crm_hunt_leads;
-- public market ads, so every member of the office may read them; only hunt_add writes
CREATE POLICY crm_hunt_leads_select_staff ON public.crm_hunt_leads FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));

CREATE TABLE IF NOT EXISTS crm_repair_private.hunt_runs (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  rows_in integer NOT NULL,
  added integer NOT NULL,
  updated integer NOT NULL
);
REVOKE ALL ON crm_repair_private.hunt_runs FROM PUBLIC, anon, authenticated;

-- a number from the sheet («63500», «63,500», «63500 ر.ع»); anything else is NULL
CREATE OR REPLACE FUNCTION crm_repair_private.hunt_num(p text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$
  SELECT CASE WHEN regexp_replace(coalesce(p, ''), '[^0-9.]', '', 'g') ~ '^\d+(\.\d+)?$'
              THEN regexp_replace(p, '[^0-9.]', '', 'g')::numeric END
$f$;
REVOKE ALL ON FUNCTION crm_repair_private.hunt_num(text) FROM PUBLIC, anon, authenticated;

-- p_rows: [{phone, name, adv_type, kind, wilayat, area, price, land, built, ref, link, source, first_seen}, …]
CREATE OR REPLACE FUNCTION crm_repair_private.hunt_add(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  co uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  x jsonb; d text; p8 text; pr numeric; ref text; n_in int := 0; n_add int := 0; n_upd int := 0; n_skip int := 0;
  hit public.crm_hunt_leads;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'hunt_rows_array_required'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    n_in := n_in + 1;
    d := regexp_replace(coalesce(x->>'phone', ''), '\D', '', 'g');
    IF length(d) = 8 THEN d := '968' || d; END IF;
    p8 := right(d, 8);
    pr := crm_repair_private.hunt_num(x->>'price');
    ref := nullif(btrim(coalesce(x->>'ref', x->>'link', '')), '');
    -- the target: a person (not an office) selling a ready villa / house in Barka at 55,000-70,000
    IF length(d) NOT BETWEEN 11 AND 15 OR left(p8, 1) NOT IN ('7', '9')
       OR coalesce(x->>'adv_type', '') LIKE '%مكتب%'
       OR coalesce(x->>'name', '') ~* '(عقار|realty|real ?estate|propert|broker|وسيط|للتسويق)'
       OR coalesce(x->>'kind', '') NOT IN ('فيلا', 'بيت', 'توين فيلا')
       OR coalesce(x->>'wilayat', '') NOT LIKE '%بركاء%'
       OR pr IS NULL OR pr NOT BETWEEN 55000 AND 70000
       -- already known: an owner offer, an owner we deal with, or one of our own numbers
       OR EXISTS (SELECT 1 FROM public.owner_leads ol JOIN public.clients k ON k.id = ol.client_id
                   WHERE ol.company_id = co AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = p8)
       OR EXISTS (SELECT 1 FROM public.owners o WHERE o.company_id = co AND right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 8) = p8)
       OR EXISTS (SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id = co
                   AND right(regexp_replace(coalesce(lr.whatsapp_number, ''), '\D', '', 'g'), 8) = p8)
    THEN n_skip := n_skip + 1; CONTINUE; END IF;

    SELECT * INTO hit FROM public.crm_hunt_leads h WHERE h.company_id = co AND h.phone8 = p8 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.crm_hunt_leads (company_id, phone8, phone, name, kind, wilayat, area, price, land_size, built_size, link, source, listings, first_seen)
      VALUES (co, p8, d, nullif(left(btrim(coalesce(x->>'name', '')), 80), ''), x->>'kind', x->>'wilayat', nullif(x->>'area', ''), pr,
              crm_repair_private.hunt_num(x->>'land'), crm_repair_private.hunt_num(x->>'built'), nullif(x->>'link', ''), nullif(x->>'source', ''),
              CASE WHEN ref IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(ref) END,
              coalesce(CASE WHEN x->>'first_seen' ~ '^\d{4}-\d{2}-\d{2}$' THEN (x->>'first_seen')::date END, (now() AT TIME ZONE 'Asia/Muscat')::date));
      n_add := n_add + 1;
    ELSIF ref IS NOT NULL AND NOT hit.listings ? ref THEN
      -- a new ad from the same number: show it again; a number on 4+ ads is an office in disguise
      UPDATE public.crm_hunt_leads SET listings = listings || jsonb_build_array(ref),
             status = CASE WHEN jsonb_array_length(listings) + 1 >= 4 THEN 'broker' ELSE status END,
             kind = x->>'kind', area = coalesce(nullif(x->>'area', ''), area), price = pr,
             land_size = coalesce(crm_repair_private.hunt_num(x->>'land'), land_size), built_size = coalesce(crm_repair_private.hunt_num(x->>'built'), built_size),
             link = coalesce(nullif(x->>'link', ''), link), source = coalesce(nullif(x->>'source', ''), source),
             last_new_at = now(), updated_at = now()
       WHERE id = hit.id;
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  INSERT INTO crm_repair_private.hunt_runs (rows_in, added, updated) VALUES (n_in, n_add, n_upd);
  RETURN jsonb_build_object('rows', n_in, 'added', n_add, 'new_ad_same_number', n_upd, 'skipped', n_skip,
    'waiting_calls', (SELECT count(*) FROM public.crm_hunt_leads h WHERE h.company_id = co AND h.status = 'new' AND h.last_new_at > now() - interval '21 days'
                        AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = co AND a.channel = 'call' AND a.actor_type = 'human'
                                         AND a.occurred_at > h.last_new_at AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8)));
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.hunt_add(jsonb) FROM PUBLIC, anon, authenticated;

-- «اتصل بعدهم»: owner offers (as before) + the hunter's direct sellers nobody called since their newest ad
CREATE OR REPLACE FUNCTION public.crm_call_next(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid := public.my_company(); r text := public.my_role(); n integer := greatest(1, least(coalesce(p_limit, 20), 50));
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR coalesce(r, '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
     (SELECT jsonb_build_object('lead_id', ol.id, 'client_id', k.id, 'name', k.name, 'phone', k.phone,
               'kind', ol.kind, 'area', ol.area, 'wilayat', ol.wilayat, 'price', ol.price, 'status', ol.status,
               'created_at', ol.created_at, 'study_days', CASE WHEN ol.status = 'studied' THEN (SELECT (now() AT TIME ZONE 'Asia/Muscat')::date - (max(s.sent_at) AT TIME ZONE 'Asia/Muscat')::date FROM public.owner_price_studies s WHERE s.owner_lead_id = ol.id AND s.status = 'sent') END,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a
                                   WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                     AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))) x
        FROM public.owner_leads ol
        JOIN public.clients k ON k.id = ol.client_id AND k.company_id = ol.company_id AND coalesce(k.archived, false) = false
        CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g') digits) d
       WHERE ol.company_id = c AND (ol.status = 'open' OR (ol.status = 'studied' AND EXISTS (SELECT 1 FROM public.owner_price_studies s LEFT JOIN public.whatsapp_conversations w ON w.id = s.conversation_id WHERE s.owner_lead_id = ol.id AND s.status = 'sent' AND s.owner_reaction IS NULL AND s.sent_at < now() - interval '7 days' AND coalesce(w.last_inbound_at, '-infinity') < s.sent_at))) AND length(d.digits) >= 8
         AND (r = 'owner' OR (NOT crm_repair_private.owner_line_is_private(ol.company_id, to_jsonb(ol))
                               AND crm_repair_private.can_access_client(c, k.id)))
         AND NOT EXISTS (SELECT 1 FROM public.activities a
                          WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                            AND a.occurred_at > now() - interval '30 days'
                            AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))
       ORDER BY ol.created_at DESC
       LIMIT n)
     UNION ALL
     (SELECT jsonb_build_object('hunt_id', h.id, 'name', h.name, 'phone', h.phone,
               'kind', CASE h.kind WHEN 'بيت' THEN 'house' ELSE 'villa' END, 'area', h.area, 'wilayat', h.wilayat, 'price', h.price,
               'status', 'hunt', 'link', h.link, 'source', h.source, 'created_at', h.last_new_at,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                    AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8))
        FROM public.crm_hunt_leads h
       WHERE h.company_id = c AND h.status = 'new' AND h.last_new_at > now() - interval '21 days'
         AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                          AND a.occurred_at > h.last_new_at AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8)
         AND NOT EXISTS (SELECT 1 FROM public.owner_leads ol JOIN public.clients k ON k.id = ol.client_id
                          WHERE ol.company_id = c AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = h.phone8)
       ORDER BY h.last_new_at DESC
       LIMIT n)) s), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.crm_call_next(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_next(integer) TO authenticated;

-- ---------------- 2. referrals ----------------
CREATE TABLE IF NOT EXISTS crm_repair_private.referral_asks (
  company_id uuid NOT NULL,
  phone8 text NOT NULL,
  party text NOT NULL CHECK (party IN ('buyer', 'owner')),
  deal_id uuid,
  task_id uuid,
  asked_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Muscat')::date,
  PRIMARY KEY (company_id, phone8, asked_on)
);
REVOKE ALL ON crm_repair_private.referral_asks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.referral_tasks_daily(p_max integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  x record; who uuid; boss uuid; agent uuid; t uuid; n int := 0;
BEGIN
  FOR x IN
    WITH d AS (
      SELECT dl.id deal_id, dl.company_id, coalesce(dl.commission_received_at, dl.closed_at, dl.updated_at) done_at, dl.client_id,
             pr.owner_id, coalesce(nullif(pr.title, ''), nullif(concat_ws(' - ', pr.area, pr.wilayat), '')) what
        FROM public.deals dl LEFT JOIN public.properties pr ON pr.id = dl.property_id
       WHERE dl.stage = 'commission_collected' AND dl.merged_into_deal_id IS NULL
    ), cand AS (
      SELECT d.deal_id, d.company_id, d.done_at, d.what, 'buyer'::text party, k.id client_id, k.name,
             right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) p8,
             k.lead_route = 'owner' private, 180 every_days
        FROM d JOIN public.clients k ON k.id = d.client_id
       WHERE NOT coalesce(k.archived, false) AND NOT coalesce(k.followup_suppressed, false)
      UNION ALL
      SELECT d.deal_id, d.company_id, d.done_at, d.what, 'owner', NULL, o.name,
             right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 8), false,
             CASE WHEN o.owner_type = 'developer' OR coalesce(o.successful_deals, 0) >= 2 THEN 60 ELSE 180 END
        FROM d JOIN public.owners o ON o.id = d.owner_id
       WHERE NOT coalesce(o.archived, false) AND coalesce(o.owner_type, 'owner') IN ('owner', 'developer')
    ), one AS (
      SELECT DISTINCT ON (company_id, p8) * FROM cand WHERE length(p8) = 8 ORDER BY company_id, p8, done_at DESC
    )
    SELECT one.* FROM one
     WHERE one.done_at < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM crm_repair_private.referral_asks a
                        WHERE a.company_id = one.company_id AND a.phone8 = one.p8 AND a.asked_on > today - one.every_days)
     ORDER BY one.done_at DESC
     LIMIT greatest(0, least(coalesce(p_max, 3), 10))
  LOOP
    SELECT p.id INTO boss FROM public.profiles p WHERE p.company_id = x.company_id AND p.role = 'owner' AND p.is_active ORDER BY p.created_at LIMIT 1;
    SELECT lr.assigned_to INTO agent FROM public.company_lead_routes lr JOIN public.profiles p ON p.id = lr.assigned_to AND p.is_active
     WHERE lr.company_id = x.company_id AND lr.route_key IN ('barka', 'muscat') ORDER BY lr.route_key LIMIT 1;
    who := CASE WHEN x.private THEN boss ELSE coalesce(agent, boss) END;
    IF who IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.tasks (company_id, user_id, client_id, deal_id, title, notes, due_date, priority, done)
    VALUES (x.company_id, who, x.client_id, x.deal_id,
            'اطلب إحالة: ' || coalesce(nullif(x.name, ''), 'عميل سابق'),
            CASE x.party WHEN 'buyer' THEN 'اشترى عن طريقنا' ELSE 'باع عن طريقنا' END
              || coalesce(' (' || x.what || ')', '') || ' بتاريخ ' || to_char(x.done_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD')
              || '. الرقم: ' || x.p8 || E'.\n'
              || 'اتصل وسلّم عليه، واسأله إذا مرتاح في ' || CASE x.party WHEN 'buyer' THEN 'البيت' ELSE 'البيعة' END
              || '، وبعدين اسأله: «تعرف أحد يبي يبيع أو يشتري بيت أو أرض؟ نخدمه مثل ما خدمناك». لو عطاك رقم سجّله عميل جديد واكتب في الملاحظة إنه إحالة من '
              || coalesce(nullif(x.name, ''), 'هالعميل') || '.',
            today, 'medium', false)
    RETURNING id INTO t;
    INSERT INTO crm_repair_private.referral_asks (company_id, phone8, party, deal_id, task_id, asked_on)
    VALUES (x.company_id, x.p8, x.party, x.deal_id, t, today) ON CONFLICT DO NOTHING;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.referral_tasks_daily(integer) FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm_referral_tasks_daily';
  -- 8:15 Muscat, Sunday-Thursday
  PERFORM cron.schedule('crm_referral_tasks_daily', '15 4 * * 0-4', 'select crm_repair_private.referral_tasks_daily(3);');
END $cron$;

-- ---------------- 3. the office: two new desks ----------------
CREATE OR REPLACE FUNCTION public.crm_office_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  c uuid := public.my_company(); u uuid := auth.uid(); r text := coalesce(public.my_role(), '');
  today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  m0 date; m1 date; snap jsonb; workers jsonb := '[]'::jsonb; staff jsonb; waiting int;
BEGIN
  IF c IS NULL OR u IS NULL OR r NOT IN ('owner', 'manager', 'agent')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = u AND company_id = c AND is_active) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  m0 := date_trunc('month', today)::date; m1 := (m0 + interval '1 month')::date - 1;
  snap := public.crm_branch_target_snapshot();

  -- ---------------- staff ----------------
  WITH people AS (
    SELECT p.id, p.full_name, p.last_login_at,
      coalesce((SELECT array_agg(rt.route_key ORDER BY rt.route_key) FROM public.company_lead_routes rt
                 WHERE rt.company_id = c AND rt.assigned_to = p.id AND rt.is_active AND rt.owner_only_inbox IS FALSE
                   AND rt.route_key IN ('barka', 'muscat')), '{}') routes
    FROM public.profiles p
    WHERE p.company_id = c AND p.is_active AND p.role IN ('agent', 'manager')
      AND (r IN ('owner', 'manager') OR p.id = u)
  ), msgs AS (
    -- customer messages and human replies only (the agent's automatic replies are left out), last 30 days
    SELECT cv.route_key, m.conversation_id, m.direction, coalesce(m.message_timestamp, m.created_at) ts
    FROM public.whatsapp_messages m JOIN public.whatsapp_conversations cv ON cv.id = m.conversation_id AND cv.company_id = m.company_id
    WHERE m.company_id = c AND m.created_at > now() - interval '30 days' AND cv.route_key IN ('barka', 'muscat')
      AND (m.direction = 'inbound' OR (m.direction = 'outbound' AND m.actor_type = 'human'))
  ), runs AS (
    SELECT *, count(*) FILTER (WHERE direction = 'outbound') OVER (PARTITION BY conversation_id ORDER BY ts ROWS UNBOUNDED PRECEDING) grp
    FROM msgs
  ), waits AS (
    SELECT route_key, conversation_id, grp, min(ts) first_in FROM runs WHERE direction = 'inbound' GROUP BY 1, 2, 3
  ), replies AS (
    SELECT conversation_id, grp - 1 g, ts FROM runs WHERE direction = 'outbound'
  ), speed AS (
    -- a message that came in during working hours (7 AM to 10 PM Muscat) to the next human reply
    SELECT w.route_key, extract(epoch FROM rp.ts - w.first_in) / 60 mins
    FROM waits w JOIN replies rp ON rp.conversation_id = w.conversation_id AND rp.g = w.grp
    WHERE extract(hour FROM w.first_in AT TIME ZONE 'Asia/Muscat') BETWEEN 7 AND 21
  ), branch_goal AS (
    SELECT b ->> 'branch' branch, b FROM jsonb_array_elements(snap -> 'branches') b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'name', pp.full_name, 'last_login_at', pp.last_login_at, 'branches', to_jsonb(pp.routes),
      'calls', crm_repair_private.call_month(c, pp.id, m0, m1),
      'tasks_done_30d', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND t.done AND t.completed_at > now() - interval '30 days'),
      'tasks_overdue', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND NOT coalesce(t.done, false) AND t.due_date < today),
      'tasks_today', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND NOT coalesce(t.done, false) AND t.due_date = today),
      'wa_replies_30d', (SELECT count(*) FROM msgs x WHERE x.direction = 'outbound' AND x.route_key = ANY (pp.routes)),
      'wa_clients_30d', (SELECT count(DISTINCT x.conversation_id) FROM msgs x WHERE x.direction = 'outbound' AND x.route_key = ANY (pp.routes)),
      'reply_minutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.mins))::numeric) FROM speed s WHERE s.route_key = ANY (pp.routes)),
      'visits_week', (SELECT coalesce(sum((g.b ->> 'viewings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'visits_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'viewings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'new_properties_week', (SELECT coalesce(sum((g.b ->> 'new_properties')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'new_properties_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'new_properties')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'bookings_month', (SELECT coalesce(sum((g.b ->> 'bookings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'bookings_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'bookings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes))
    ) ORDER BY pp.full_name), '[]'::jsonb)
  INTO staff FROM people pp;

  -- conversations whose last message is the customer's and nobody (agent or human) answered, last 3 days
  SELECT count(*) INTO waiting FROM public.whatsapp_conversations cv
  WHERE cv.company_id = c AND cv.route_key IN ('barka', 'muscat')
    AND (r IN ('owner', 'manager') OR crm_repair_private.staff_is_branch_member(c, cv.route_key))
    AND cv.last_inbound_at > now() - interval '3 days' AND cv.last_inbound_at > coalesce(cv.last_outbound_at, '-infinity')
    AND (cv.ignored_at IS NULL OR cv.ignored_at < cv.last_inbound_at)
    AND (cv.waiting_done_at IS NULL OR cv.waiting_done_at < cv.last_inbound_at);

  -- ---------------- automatic workers (owner / manager only) ----------------
  IF r IN ('owner', 'manager') THEN
    WITH def(ord, key, name, icon, jobs, max_age) AS (VALUES
      (1, 'brain', 'العقل (يرد في واتساب)', '💬', ARRAY['crm-retry-failed-agent-sends'], interval '6 hours'),
      (2, 'audit', 'فاحص الردود', '🧐', ARRAY['reply_audit_morning', 'reply_audit_afternoon'], interval '30 hours'),
      (3, 'coach', 'مدرب الردود (أسبوعي)', '🎓', ARRAY['reply_coach_weekly'], interval '8 days'),
      (4, 'pricing', 'المسعّر', '🏷️', ARRAY['owner_price_study_tick', 'owner_price_study_unpriced', 'owner_price_study_held', 'owner_price_study_drive', 'owner_price_study_open_tasks'], interval '2 hours'),
      (5, 'followups', 'متابعة بعد الزيارة', '📅', ARRAY['habib_visit_followups_queue', 'habib_visit_followups_auto_send'], interval '2 hours'),
      (6, 'outreach', 'رسائل العملاء القدامى', '📣', ARRAY['outreach_queue_requests', 'outreach_send_approved', 'outreach_seed_requests_daily', 'outreach_auto_sold_notice'], interval '2 hours'),
      (7, 'matcher', 'مطابقة عروض الملاك', '🏠', ARRAY['owner_leads_match_daily'], interval '30 hours'),
      (8, 'alerts', 'تنبيهات العقارات', '🔔', ARRAY['crm_property_alerts_run', 'crm_expire_listing_agreements_daily', 'agreement_ending_whatsapp'], interval '30 hours'),
      (9, 'voice', 'مفرّغ الرسائل الصوتية', '🎙️', ARRAY['whatsapp_transcribe_voice_notes'], interval '2 hours'),
      (10, 'instagram', 'متابع إنستغرام', '📸', ARRAY['habib_instagram_media_discovery'], interval '2 hours'),
      -- SQL162: the hunter runs in the daily cloud check of the market sheet (no cron), the referrals in a cron
      (11, 'hunter', 'صائد العقارات', '🎯', ARRAY[]::text[], interval '50 hours'),
      (12, 'referrals', 'مسؤول الإحالات', '🤝', ARRAY['crm_referral_tasks_daily'], interval '4 days')
    ), runs AS (
      SELECT d.key, max(l.start_time) last_run,
        count(*) FILTER (WHERE l.status = 'failed') failed,
        count(j.jobid) found
      FROM def d LEFT JOIN cron.job j ON j.jobname = ANY (d.jobs) AND j.active
      LEFT JOIN crm_repair_private.cron_last_runs l ON l.jobid = j.jobid
      GROUP BY d.key
    ), facts AS (
      SELECT 'brain' key,
        (SELECT max(created_at) FROM public.whatsapp_reply_drafts WHERE company_id = c) last_out,
        (SELECT count(*) FROM public.whatsapp_reply_drafts WHERE company_id = c AND (created_at AT TIME ZONE 'Asia/Muscat')::date = today)::text || ' رد اليوم' did
      UNION ALL SELECT 'audit', (SELECT max(created_at) FROM public.whatsapp_reply_audit_runs),
        (SELECT count(*) FROM public.whatsapp_reply_audit_findings f WHERE f.created_at > now() - interval '24 hours')::text || ' ملاحظة آخر يوم'
      UNION ALL SELECT 'coach', (SELECT max(created_at) FROM public.whatsapp_reply_coach_reports), 'تقرير كل سبت'
      UNION ALL SELECT 'pricing', (SELECT max(created_at) FROM public.owner_price_studies WHERE company_id = c),
        (SELECT count(*) FROM public.owner_price_studies WHERE company_id = c AND created_at >= m0)::text || ' دراسة هالشهر'
      UNION ALL SELECT 'followups', (SELECT max(created_at) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_followup'),
        (SELECT count(*) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_followup' AND created_at > now() - interval '7 days')::text || ' رسالة هالأسبوع'
      UNION ALL SELECT 'outreach', (SELECT max(created_at) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_outreach'),
        (SELECT count(*) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_outreach' AND created_at > now() - interval '7 days')::text || ' رسالة هالأسبوع'
      UNION ALL SELECT 'matcher', NULL, (SELECT count(*) FROM public.owner_lead_matches)::text || ' مطابقة'
      UNION ALL SELECT 'alerts', NULL, NULL
      UNION ALL SELECT 'voice', NULL, NULL
      UNION ALL SELECT 'instagram', NULL, NULL
      UNION ALL SELECT 'hunter', (SELECT max(ran_at) FROM crm_repair_private.hunt_runs),
        (SELECT count(*) FROM public.crm_hunt_leads h WHERE h.company_id = c AND h.status = 'new' AND h.last_new_at > now() - interval '21 days'
           AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                            AND a.occurred_at > h.last_new_at AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8))::text || ' بائع ينتظر اتصال'
      UNION ALL SELECT 'referrals', (SELECT max(t.created_at) FROM crm_repair_private.referral_asks a JOIN public.tasks t ON t.id = a.task_id WHERE a.company_id = c),
        (SELECT count(*) FROM crm_repair_private.referral_asks a WHERE a.company_id = c AND a.asked_on >= m0)::text || ' طلب إحالة هالشهر'
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key', d.key, 'name', d.name, 'icon', d.icon, 'last_run', CASE WHEN d.key = 'hunter' THEN f.last_out ELSE rn.last_run END, 'last_output', f.last_out, 'did', f.did,
        'status', CASE
          WHEN d.key = 'hunter' THEN CASE WHEN f.last_out IS NULL THEN 'off' WHEN f.last_out < now() - d.max_age THEN 'yellow' ELSE 'green' END
          WHEN rn.found = 0 THEN 'off'
          WHEN rn.failed > 0 THEN 'red'
          WHEN rn.last_run IS NULL OR rn.last_run < now() - d.max_age THEN 'yellow'
          -- the reply agent: a customer message newer than its last draft by more than 20 minutes
          WHEN d.key = 'brain' AND EXISTS (
            SELECT 1 FROM public.whatsapp_messages m JOIN public.whatsapp_conversations cv ON cv.id = m.conversation_id
            WHERE m.company_id = c AND m.direction = 'inbound' AND cv.route_key IN ('barka', 'muscat') AND NOT coalesce(cv.agent_muted, false)
              AND m.created_at > now() - interval '3 hours' AND m.created_at < now() - interval '20 minutes'
              AND m.created_at > coalesce(f.last_out, '-infinity')) THEN 'red'
          ELSE 'green' END
      ) ORDER BY d.ord), '[]'::jsonb)
    INTO workers FROM def d JOIN runs rn ON rn.key = d.key LEFT JOIN facts f ON f.key = d.key;
  END IF;

  RETURN jsonb_build_object('today', today, 'now', now(), 'role', r, 'waiting_conversations', waiting,
    'workers', workers, 'staff', staff,
    'failed_jobs', CASE WHEN r IN ('owner', 'manager') THEN (
      SELECT coalesce(jsonb_agg(j.jobname ORDER BY j.jobname), '[]'::jsonb) FROM cron.job j JOIN crm_repair_private.cron_last_runs l ON l.jobid = j.jobid
      WHERE j.active AND l.status = 'failed') ELSE '[]'::jsonb END);
END $function$;

REVOKE ALL ON FUNCTION public.crm_office_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_office_snapshot() TO authenticated;
