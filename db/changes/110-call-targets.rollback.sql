-- Rollback of SQL110: the call functions of SQL100 / SQL107 come back (target 20, three kinds, free next step).
-- crm_call_day_notes is kept (the reasons written are history); drop it by hand if really wanted.
SET LOCAL lock_timeout = '10s';

DROP FUNCTION IF EXISTS public.crm_call_day_note_clear(date, uuid, boolean);
DROP FUNCTION IF EXISTS public.crm_call_day_note(date, text, text, uuid, date, boolean);
DROP FUNCTION IF EXISTS public.crm_calls_log(integer);
DROP FUNCTION IF EXISTS public.crm_log_call(uuid, text, text, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS public.crm_log_call_number(text, text, text, text, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS public.crm_calls_today();
DROP FUNCTION IF EXISTS crm_repair_private.call_insert(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, jsonb);
DROP FUNCTION IF EXISTS crm_repair_private.call_sum(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS crm_repair_private.call_people(uuid, date);
DROP FUNCTION IF EXISTS crm_repair_private.call_day_target(uuid, uuid, date);

CREATE FUNCTION public.crm_log_call(p_client uuid, p_kind text, p_result text, p_next text, p_note text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); a public.activities%rowtype;
  kinds jsonb := '{"advertiser":"اتصال على معلن","owner":"اتصال على مالك","after_visit":"اتصال على عميل بعد معاينة"}';
  results jsonb := '{"agreed":"رد ووافق","refused":"رد ورفض","no_answer":"ما رد","call_later":"يتصل بعدين"}';
  txt text;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent')
     OR p_client IS NULL OR NOT crm_repair_private.can_access_client(c, p_client) THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR NOT (kinds ? coalesce(p_kind, '')) OR NOT (results ? coalesce(p_result, '')) THEN
    RAISE EXCEPTION 'call_kind_and_result_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.activities WHERE id = p_key;
  IF FOUND THEN
    IF a.user_id <> u OR a.company_id <> c THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('ok', true, 'activity_id', a.id, 'replayed', true);
  END IF;
  txt := (kinds ->> p_kind) || ' · ' || (results ->> p_result) || coalesce(' · ' || nullif(btrim(p_note), ''), '');
  INSERT INTO public.activities (id, company_id, user_id, client_id, type, activity_type, description, activity_text, channel, direction,
                                 actor_type, outcome, next_action, occurred_at, recorded_at, after_data)
  VALUES (p_key, c, u, p_client, 'call', 'call', left(txt, 1000), left(txt, 1000), 'call', 'outbound', 'human', results ->> p_result,
          nullif(left(btrim(coalesce(p_next, '')), 300), ''), clock_timestamp(), clock_timestamp(),
          jsonb_build_object('call_kind', p_kind, 'call_result', p_result, 'source', 'crm_log_call'));
  UPDATE public.clients SET last_contact_at = clock_timestamp() WHERE id = p_client AND company_id = c;
  RETURN jsonb_build_object('ok', true, 'activity_id', p_key, 'replayed', false);
END $function$;
REVOKE ALL ON FUNCTION public.crm_log_call(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_log_call(uuid, text, text, text, text, uuid) TO authenticated;

CREATE FUNCTION public.crm_calls_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), '');
  t0 timestamptz := ((now() AT TIME ZONE 'Asia/Muscat')::date)::timestamp AT TIME ZONE 'Asia/Muscat';
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('target', 20,
    'mine', (SELECT count(*) FROM public.activities a WHERE a.company_id = c AND a.user_id = u AND a.channel = 'call' AND a.actor_type = 'human' AND a.occurred_at >= t0),
    'people', CASE WHEN r IN ('owner', 'manager') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'calls', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                FROM (SELECT a.user_id, count(*) n FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human' AND a.occurred_at >= t0 GROUP BY 1) x
                JOIN public.profiles p ON p.id = x.user_id) ELSE '[]'::jsonb END);
END $function$;
REVOKE ALL ON FUNCTION public.crm_calls_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_calls_today() TO authenticated;

CREATE FUNCTION public.crm_log_call_number(p_phone text, p_name text, p_kind text, p_result text, p_next text, p_note text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); a public.activities%rowtype;
  kinds jsonb := '{"advertiser":"اتصال على معلن","owner":"اتصال على مالك","after_visit":"اتصال على عميل بعد معاينة"}';
  results jsonb := '{"agreed":"رد ووافق","refused":"رد ورفض","no_answer":"ما رد","call_later":"يتصل بعدين"}';
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'); nm text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  cl uuid; txt text;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF length(d) < 8 OR length(d) > 15 THEN RAISE EXCEPTION 'call_phone_required' USING ERRCODE = '22023'; END IF;
  IF length(d) = 8 THEN d := '968' || d; END IF;
  IF p_key IS NULL OR NOT (kinds ? coalesce(p_kind, '')) OR NOT (results ? coalesce(p_result, '')) THEN
    RAISE EXCEPTION 'call_kind_and_result_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.activities WHERE id = p_key;
  IF FOUND THEN
    IF a.user_id <> u OR a.company_id <> c THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('ok', true, 'activity_id', a.id, 'client_id', a.client_id, 'replayed', true);
  END IF;
  SELECT k.id INTO cl FROM public.clients k
   WHERE k.company_id = c AND coalesce(k.archived, false) = false
     AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = right(d, 8)
     AND crm_repair_private.can_access_client(c, k.id)
   ORDER BY k.created_at LIMIT 1;
  txt := (kinds ->> p_kind) || ' · ' || coalesce(nm || ' ', '') || d || ' · ' || (results ->> p_result) || coalesce(' · ' || nullif(btrim(p_note), ''), '');
  INSERT INTO public.activities (id, company_id, user_id, client_id, type, activity_type, description, activity_text, channel, direction,
                                 actor_type, outcome, next_action, occurred_at, recorded_at, after_data)
  VALUES (p_key, c, u, cl, 'call', 'call', left(txt, 1000), left(txt, 1000), 'call', 'outbound', 'human', results ->> p_result,
          nullif(left(btrim(coalesce(p_next, '')), 300), ''), clock_timestamp(), clock_timestamp(),
          jsonb_build_object('call_kind', p_kind, 'call_result', p_result, 'call_phone', d, 'call_name', nm, 'source', 'crm_log_call_number'));
  IF cl IS NOT NULL THEN UPDATE public.clients SET last_contact_at = clock_timestamp() WHERE id = cl AND company_id = c; END IF;
  RETURN jsonb_build_object('ok', true, 'activity_id', p_key, 'client_id', cl, 'replayed', false);
END $function$;
REVOKE ALL ON FUNCTION public.crm_log_call_number(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_log_call_number(text, text, text, text, text, text, uuid) TO authenticated;
