-- SQL110 (17 Nov 2026, Ahmed): «📞 سجّل اتصال» is for calls to owners and advertisers only, with a short next step, a target of
-- 10 calls a working day (was 20), weekly and monthly targets, and a call log where a short day has its reason.
--   1. crm_log_call / crm_log_call_number: the kinds are «معلن» and «مالك» only («عميل بعد معاينة» is refused; old records stay).
--      The next step follows the result: «رد ووافق» → «يرسل التفاصيل على الواتساب» or «يتصل بعدين» at a day and hour;
--      «يتصل بعدين» → a day and hour, required, in the future; «ما رد» and «رد ورفض» → «ما في خطوة». A call back becomes a task
--      for the caller on that day. New signatures (p_next_step, p_next_at); the old ones are dropped (md5 checked).
--   2. crm_call_day_notes: why a day is short. «إجازة رسمية» (owner or manager, for everyone or one person) and «إجازة» (annual
--      leave, a range of days) take the day out of the target; «انشغل بشغل أهم» and «سبب ثاني» keep the target and say why.
--      Written only through crm_call_day_note / crm_call_day_note_clear (row level security on, no policy).
--   3. Targets: 10 a day Sunday to Thursday; Friday, Saturday and days off count 0. The week (Sunday to Saturday) and the month are
--      the sum of their days (a full week = 50; November 2026 = 220 before holidays).
--   4. crm_calls_today(): today, this week and this month of the person signed in; the owner and the manager see each person.
--      crm_calls_log(p_days): each day of the last p_days with calls, target, reason and the calls themselves (caller's own days;
--      the owner and the manager see every staff member).
-- Rollback: 110-call-targets.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_log_call(uuid, text, text, text, text, uuid)'::regprocedure)) <> '9c80e070a2df3ce6fdcb8d5b1a0c00bd'
     OR md5(pg_get_functiondef('public.crm_log_call_number(text, text, text, text, text, text, uuid)'::regprocedure)) <> 'aabf3e2ad3ebeab245e9dde52e1a66ac'
     OR md5(pg_get_functiondef('public.crm_calls_today()'::regprocedure)) <> '85e7b5d090c9b408915b7f639c9251fa' THEN
    RAISE EXCEPTION 'SQL110 refused: a call function changed since 16 Nov 2026, read it again first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_call_day_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,   -- NULL = everyone (official holiday)
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('holiday', 'leave', 'busy', 'other')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_call_day_notes_one ON public.crm_call_day_notes (company_id, user_id, day) NULLS NOT DISTINCT;
ALTER TABLE public.crm_call_day_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_call_day_notes FROM PUBLIC, anon, authenticated;

-- the day's target of one person: 10 Sunday to Thursday, 0 on Friday, Saturday, an official holiday or leave
CREATE OR REPLACE FUNCTION crm_repair_private.call_day_target(p_company uuid, p_user uuid, p_day date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN extract(isodow FROM p_day) IN (5, 6) THEN 0
              WHEN EXISTS (SELECT 1 FROM public.crm_call_day_notes n WHERE n.company_id = p_company AND n.day = p_day
                             AND n.kind IN ('holiday', 'leave') AND (n.user_id IS NULL OR n.user_id = p_user)) THEN 0
              ELSE 10 END;
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.call_day_target(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- one call by a person: the record both log functions write
CREATE OR REPLACE FUNCTION crm_repair_private.call_insert(p_key uuid, p_company uuid, p_user uuid, p_client uuid, p_kind text, p_result text,
                                                          p_next_step text, p_next_at timestamptz, p_note text, p_who text, p_extra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.activities%rowtype;
  kinds jsonb := '{"advertiser":"اتصال على معلن","owner":"اتصال على مالك"}';
  results jsonb := '{"agreed":"رد ووافق","refused":"رد ورفض","no_answer":"ما رد","call_later":"يتصل بعدين"}';
  local timestamp := p_next_at AT TIME ZONE 'Asia/Muscat';
  nxt text; txt text; task uuid;
BEGIN
  IF p_key IS NULL OR NOT (kinds ? coalesce(p_kind, '')) OR NOT (results ? coalesce(p_result, '')) THEN
    RAISE EXCEPTION 'call_kind_and_result_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.activities WHERE id = p_key;
  IF FOUND THEN
    IF a.user_id <> p_user OR a.company_id <> p_company THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('ok', true, 'activity_id', a.id, 'client_id', a.client_id, 'replayed', true);
  END IF;
  -- the next step follows the result
  IF p_result IN ('no_answer', 'refused') THEN
    IF coalesce(p_next_step, 'none') <> 'none' THEN RAISE EXCEPTION 'call_next_none_only' USING ERRCODE = '22023'; END IF;
    p_next_step := 'none'; p_next_at := NULL;
  ELSIF p_result = 'call_later' THEN
    IF coalesce(p_next_step, 'call_later') <> 'call_later' THEN RAISE EXCEPTION 'call_next_call_later_only' USING ERRCODE = '22023'; END IF;
    p_next_step := 'call_later';
  ELSIF coalesce(p_next_step, '') NOT IN ('send_details', 'call_later') THEN
    RAISE EXCEPTION 'call_next_required' USING ERRCODE = '22023';
  END IF;
  IF p_next_step = 'call_later' THEN
    IF p_next_at IS NULL OR p_next_at < now() - interval '5 minutes' OR p_next_at > now() + interval '90 days' THEN
      RAISE EXCEPTION 'call_back_time_required' USING ERRCODE = '22023';
    END IF;
    nxt := 'يتصل ' || to_char(local, 'YYYY-MM-DD') || ' الساعة ' || to_char(local, 'HH24:MI');
  ELSIF p_next_step = 'send_details' THEN nxt := 'يرسل التفاصيل على الواتساب'; p_next_at := NULL;
  ELSE nxt := 'ما في خطوة';
  END IF;
  txt := (kinds ->> p_kind) || coalesce(' · ' || nullif(p_who, ''), '') || ' · ' || (results ->> p_result) || ' · ' || nxt
         || coalesce(' · ' || nullif(btrim(p_note), ''), '');
  INSERT INTO public.activities (id, company_id, user_id, client_id, type, activity_type, description, activity_text, channel, direction,
                                 actor_type, outcome, next_action, occurred_at, recorded_at, after_data)
  VALUES (p_key, p_company, p_user, p_client, 'call', 'call', left(txt, 1000), left(txt, 1000), 'call', 'outbound', 'human',
          results ->> p_result, nxt, clock_timestamp(), clock_timestamp(),
          jsonb_build_object('call_kind', p_kind, 'call_result', p_result, 'next_step', p_next_step, 'next_call_at', p_next_at) || coalesce(p_extra, '{}'::jsonb));
  IF p_client IS NOT NULL THEN UPDATE public.clients SET last_contact_at = clock_timestamp() WHERE id = p_client AND company_id = p_company; END IF;
  IF p_next_step = 'call_later' THEN
    INSERT INTO public.tasks (company_id, user_id, client_id, title, notes, due_date, priority, done)
    VALUES (p_company, p_user, p_client, left('📞 اتصل على ' || coalesce(nullif(p_who, ''), 'العميل') || ' الساعة ' || to_char(local, 'HH24:MI'), 200),
            'من «سجّل اتصال»: ' || (kinds ->> p_kind) || ' · ' || (results ->> p_result) || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
            local::date, 'high', false)
    RETURNING id INTO task;
  END IF;
  RETURN jsonb_build_object('ok', true, 'activity_id', p_key, 'client_id', p_client, 'task_id', task, 'replayed', false);
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.call_insert(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.crm_log_call(uuid, text, text, text, text, uuid);
CREATE FUNCTION public.crm_log_call(p_client uuid, p_kind text, p_result text, p_next_step text, p_next_at timestamptz, p_note text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); nm text;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent')
     OR p_client IS NULL OR NOT crm_repair_private.can_access_client(c, p_client) THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT k.name INTO nm FROM public.clients k WHERE k.id = p_client AND k.company_id = c;
  RETURN crm_repair_private.call_insert(p_key, c, u, p_client, p_kind, p_result, p_next_step, p_next_at, p_note,
                                        nullif(left(btrim(coalesce(nm, '')), 80), ''), jsonb_build_object('source', 'crm_log_call'));
END $function$;
REVOKE ALL ON FUNCTION public.crm_log_call(uuid, text, text, text, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_log_call(uuid, text, text, text, timestamptz, text, uuid) TO authenticated;

DROP FUNCTION public.crm_log_call_number(text, text, text, text, text, text, uuid);
CREATE FUNCTION public.crm_log_call_number(p_phone text, p_name text, p_kind text, p_result text, p_next_step text, p_next_at timestamptz, p_note text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company();
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'); nm text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  cl uuid;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF length(d) < 8 OR length(d) > 15 THEN RAISE EXCEPTION 'call_phone_required' USING ERRCODE = '22023'; END IF;
  IF length(d) = 8 THEN d := '968' || d; END IF;
  SELECT k.id INTO cl FROM public.clients k
   WHERE k.company_id = c AND coalesce(k.archived, false) = false
     AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = right(d, 8)
     AND crm_repair_private.can_access_client(c, k.id)
   ORDER BY k.created_at LIMIT 1;
  RETURN crm_repair_private.call_insert(p_key, c, u, cl, p_kind, p_result, p_next_step, p_next_at, p_note, coalesce(nm || ' ', '') || d,
                                        jsonb_build_object('call_phone', d, 'call_name', nm, 'source', 'crm_log_call_number'));
END $function$;
REVOKE ALL ON FUNCTION public.crm_log_call_number(text, text, text, text, text, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_log_call_number(text, text, text, text, text, timestamptz, text, uuid) TO authenticated;

-- the staff whose calls are counted: active agents and managers, and anyone else who logged a call in the period
CREATE OR REPLACE FUNCTION crm_repair_private.call_people(p_company uuid, p_from date)
 RETURNS TABLE(user_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, coalesce(nullif(p.full_name, ''), 'موظف') FROM public.profiles p
   WHERE p.company_id = p_company
     AND ((p.role IN ('agent', 'manager') AND coalesce(p.is_active, false))
          OR EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = p_company AND a.user_id = p.id AND a.channel = 'call'
                       AND a.actor_type = 'human' AND a.occurred_at >= (p_from::timestamp AT TIME ZONE 'Asia/Muscat')));
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.call_people(uuid, date) FROM PUBLIC, anon, authenticated;

-- calls and target of one person between two days (both included)
CREATE OR REPLACE FUNCTION crm_repair_private.call_sum(p_company uuid, p_user uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'calls', (SELECT count(*) FROM public.activities a WHERE a.company_id = p_company AND a.user_id = p_user AND a.channel = 'call'
                AND a.actor_type = 'human' AND a.occurred_at >= (p_from::timestamp AT TIME ZONE 'Asia/Muscat')
                AND a.occurred_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Muscat')),
    'target', (SELECT coalesce(sum(crm_repair_private.call_day_target(p_company, p_user, g::date)), 0)
                 FROM generate_series(p_from, p_to, interval '1 day') g),
    'from', p_from, 'to', p_to);
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.call_sum(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.crm_calls_today();
CREATE FUNCTION public.crm_calls_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), '');
  d date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  w0 date; m0 date := date_trunc('month', d)::date; m1 date;
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  w0 := d - (extract(dow FROM d))::int;            -- Sunday
  m1 := (m0 + interval '1 month')::date - 1;
  RETURN jsonb_build_object('day', d, 'daily_target', 10,
    'target', crm_repair_private.call_day_target(c, u, d),
    'mine', ((crm_repair_private.call_sum(c, u, d, d)) ->> 'calls')::int,
    'week', crm_repair_private.call_sum(c, u, w0, w0 + 6),
    'month', crm_repair_private.call_sum(c, u, m0, m1),
    'people', CASE WHEN r IN ('owner', 'manager') THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name,
               'calls', ((crm_repair_private.call_sum(c, p.user_id, d, d)) ->> 'calls')::int,
               'target', crm_repair_private.call_day_target(c, p.user_id, d),
               'week', crm_repair_private.call_sum(c, p.user_id, w0, w0 + 6),
               'month', crm_repair_private.call_sum(c, p.user_id, m0, m1)) ORDER BY p.name), '[]'::jsonb)
        FROM crm_repair_private.call_people(c, m0) p) ELSE '[]'::jsonb END);
END $function$;
REVOKE ALL ON FUNCTION public.crm_calls_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_calls_today() TO authenticated;

-- the call log: one row per person and day, newest first, with the calls of the day
CREATE OR REPLACE FUNCTION public.crm_calls_log(p_days integer DEFAULT 31)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), '');
  d date := (now() AT TIME ZONE 'Asia/Muscat')::date; f date;
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  f := d - (least(greatest(coalesce(p_days, 31), 1), 92) - 1);
  RETURN jsonb_build_object('today', d, 'from', f, 'daily_target', 10, 'people', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name, 'days', (
      SELECT jsonb_agg(jsonb_build_object(
               'day', g::date,
               'target', crm_repair_private.call_day_target(c, p.user_id, g::date),
               'calls', (SELECT count(*) FROM public.activities a WHERE a.company_id = c AND a.user_id = p.user_id AND a.channel = 'call'
                           AND a.actor_type = 'human' AND (a.occurred_at AT TIME ZONE 'Asia/Muscat')::date = g::date),
               'note', (SELECT jsonb_build_object('kind', n.kind, 'note', n.note, 'all', n.user_id IS NULL)
                          FROM public.crm_call_day_notes n WHERE n.company_id = c AND n.day = g::date
                           AND (n.user_id = p.user_id OR n.user_id IS NULL) ORDER BY n.user_id NULLS LAST LIMIT 1),
               'list', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'text', a.activity_text, 'result', a.after_data ->> 'call_result',
                                 'next', a.next_action, 'phone', coalesce(a.after_data ->> 'call_phone', k.phone), 'client_id', a.client_id)
                                 ORDER BY a.occurred_at), '[]'::jsonb)
                          FROM public.activities a LEFT JOIN public.clients k ON k.id = a.client_id
                         WHERE a.company_id = c AND a.user_id = p.user_id AND a.channel = 'call' AND a.actor_type = 'human'
                           AND (a.occurred_at AT TIME ZONE 'Asia/Muscat')::date = g::date))
             ORDER BY g DESC)
        FROM generate_series(f, d, interval '1 day') g)) ORDER BY p.name), '[]'::jsonb)
      FROM crm_repair_private.call_people(c, f) p
     WHERE r IN ('owner', 'manager') OR p.user_id = u));
END $function$;
REVOKE ALL ON FUNCTION public.crm_calls_log(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_calls_log(integer) TO authenticated;

-- why a day is short. Staff write their own days; the owner and the manager write anyone's, or everyone's (official holiday).
CREATE OR REPLACE FUNCTION public.crm_call_day_note(p_day date, p_kind text, p_note text, p_user uuid DEFAULT NULL, p_until date DEFAULT NULL, p_all boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), '');
  who uuid; last_day date := coalesce(p_until, p_day); g date; n int := 0;
  today date := (now() AT TIME ZONE 'Asia/Muscat')::date; txt text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_day IS NULL OR coalesce(p_kind, '') NOT IN ('holiday', 'leave', 'busy', 'other') THEN RAISE EXCEPTION 'day_and_reason_required' USING ERRCODE = '22023'; END IF;
  IF last_day < p_day OR last_day - p_day > 60 THEN RAISE EXCEPTION 'range_up_to_60_days' USING ERRCODE = '22023'; END IF;
  IF p_kind IN ('busy', 'other') AND (txt IS NULL OR p_until IS NOT NULL OR p_day > today) THEN
    RAISE EXCEPTION 'reason_text_for_a_past_day' USING ERRCODE = '22023';   -- a short day is explained after it, in words
  END IF;
  IF p_all THEN
    IF r NOT IN ('owner', 'manager') OR p_kind <> 'holiday' THEN RAISE EXCEPTION 'holiday_for_all_owner_only' USING ERRCODE = '42501'; END IF;
    who := NULL;
  ELSE
    who := coalesce(p_user, u);
    IF who <> u AND r NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'own_days_only' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = who AND p.company_id = c) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_day < today - 62 THEN RAISE EXCEPTION 'too_old' USING ERRCODE = '22023'; END IF;
  FOR g IN SELECT x::date FROM generate_series(p_day, last_day, interval '1 day') x LOOP
    INSERT INTO public.crm_call_day_notes (company_id, user_id, day, kind, note, created_by)
    VALUES (c, who, g, p_kind, txt, u)
    ON CONFLICT (company_id, user_id, day) DO UPDATE SET kind = excluded.kind, note = excluded.note, created_by = excluded.created_by, created_at = now();
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'days', n);
END $function$;
REVOKE ALL ON FUNCTION public.crm_call_day_note(date, text, text, uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_day_note(date, text, text, uuid, date, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_call_day_note_clear(p_day date, p_user uuid DEFAULT NULL, p_all boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), ''); who uuid; n int;
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_all AND r NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'holiday_for_all_owner_only' USING ERRCODE = '42501'; END IF;
  who := CASE WHEN p_all THEN NULL ELSE coalesce(p_user, u) END;
  IF NOT p_all AND who <> u AND r NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'own_days_only' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.crm_call_day_notes n WHERE n.company_id = c AND n.day = p_day AND n.user_id IS NOT DISTINCT FROM who;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'removed', n);
END $function$;
REVOKE ALL ON FUNCTION public.crm_call_day_note_clear(date, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_day_note_clear(date, uuid, boolean) TO authenticated;
