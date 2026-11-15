-- SQL107 (16 Nov 2026, R87, Ahmed: the staff phoned an owner and asked him to send his property on WhatsApp; the agent answered
-- him as a new owner and she had to delete the reply. And «وين هذا الزر؟ ما حصلته»: «سجّل اتصال» was only on an open client page).
--   1. crm_log_call_number(...): a call is logged by the number itself, also for a person who is not a client yet. Same record as
--      crm_log_call (activities, channel call, actor human, the person signed in), with the number and the name in after_data;
--      when the number belongs to a client the caller may see, the call is saved on that client too. It counts in crm_calls_today.
--   2. crm_staff_called(company, phone): for the reply agent (service_role only). The last call of the last 14 days that a staff
--      member logged to this number as an owner or an advertiser, by the number or through the client record.
-- Nothing existing is changed. Rollback: 107-call-by-number.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_log_call_number(p_phone text, p_name text, p_kind text, p_result text, p_next text, p_note text, p_key uuid)
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

CREATE OR REPLACE FUNCTION public.crm_staff_called(p_company uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object('at', a.occurred_at, 'kind', a.after_data ->> 'call_kind', 'by', p.full_name, 'name', a.after_data ->> 'call_name')
    FROM public.activities a
    LEFT JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN public.clients k ON k.id = a.client_id
   WHERE a.company_id = p_company AND a.channel = 'call' AND a.actor_type = 'human'
     AND a.after_data ->> 'call_kind' IN ('owner', 'advertiser')
     AND a.occurred_at > now() - interval '14 days'
     AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
     AND right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8) IN (
           right(coalesce(a.after_data ->> 'call_phone', ''), 8),
           right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8))
   ORDER BY a.occurred_at DESC LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.crm_staff_called(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_staff_called(uuid, text) TO service_role;
