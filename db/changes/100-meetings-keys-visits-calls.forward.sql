-- SQL100 (14 Nov 2026, Ahmed): four changes from one request, each small and reversible.
--   1. R46 «المفتاح وين يكون ؟»: the owner's answer is kept on the owner offer (owner_leads.visit_method / visit_instructions),
--      written by the reply agent, read by the daily visits message (scheduled task «رسالة زيارات اليوم»).
--   2. R47 the question after a visit goes to every client 90 minutes after the visit time. crm_fast_visit_candidates no
--      longer drops a client because an open handoff, Ahmed / staff typing after the visit, the client writing after the
--      visit or a later visit; only a muted chat or a negotiation handoff hold it here (the review keeps the three exceptions
--      Ahmed chose: opinion already said, property sold or withdrawn, negotiation / running deal). Replaces the live body
--      (md5 checked below, the 8 Nov anchor version).
--   3. «معاينات أمس بدون متابعة من العقل»: crm_visits_unasked(day) for the staff list on «متابعة اليوم».
--   4. «📞 سجّل اتصال»: crm_log_call(...) writes activities (channel call, actor human, user = the person signed in) and
--      crm_calls_today() counts today's calls against the target of 20.
-- Nothing else changes: no trigger, no cron, no edge function, no existing table column.
-- Rollback: 100-meetings-keys-visits-calls.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_fast_visit_candidates()'::regprocedure)) <> '572e913595db452c12b7b2ac04272730' THEN
    RAISE EXCEPTION 'SQL100 refused: crm_fast_visit_candidates changed since 14 Nov 2026, read it again first';
  END IF;
  IF to_regprocedure('crm_repair_private.can_access_client(uuid, uuid)') IS NULL OR to_regprocedure('public.my_company()') IS NULL
     OR to_regprocedure('public.my_role()') IS NULL THEN
    RAISE EXCEPTION 'SQL100 refused: access helpers missing';
  END IF;
END $$;

-- 1. R46: how we get in, on the owner offer (same values as properties.visit_method)
ALTER TABLE public.owner_leads ADD COLUMN IF NOT EXISTS visit_method text;
ALTER TABLE public.owner_leads ADD COLUMN IF NOT EXISTS visit_instructions text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_leads_visit_method_check') THEN
    ALTER TABLE public.owner_leads ADD CONSTRAINT owner_leads_visit_method_check
      CHECK (visit_method IS NULL OR visit_method IN ('open', 'lockbox', 'owner_lives', 'office'));
  END IF;
END $$;

-- 2. R47: every visit, 90 minutes after its time
CREATE OR REPLACE FUNCTION public.crm_fast_visit_candidates()
 RETURNS TABLE(viewing_id uuid, company_id uuid, client_id uuid, request_id uuid, conversation_id uuid, route_key text, visit_at timestamp with time zone, last_in timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH v AS (
    SELECT DISTINCT ON (vw.client_id) vw.id, vw.company_id, vw.client_id, vw.request_id,
           ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') AS visit_at
      FROM public.viewings vw
     WHERE coalesce(vw.archived, false) = false
       AND vw.status IN ('scheduled','confirmed','done')
       AND vw.viewing_date BETWEEN (now() AT TIME ZONE 'Asia/Muscat')::date - 1 AND (now() AT TIME ZONE 'Asia/Muscat')::date
       AND ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') <= now() - interval '90 minutes'
     ORDER BY vw.client_id, vw.viewing_date DESC, vw.viewing_time DESC NULLS LAST
  )
  SELECT v.id, v.company_id, v.client_id, v.request_id, cv.id, cv.route_key, v.visit_at, li.last_in
    FROM v
    JOIN public.clients cl ON cl.id = v.client_id AND coalesce(cl.archived, false) = false
         AND coalesce(cl.followup_suppressed, false) = false AND coalesce(cl.phone, '') <> ''
    JOIN LATERAL (
      SELECT wc.id, wc.route_key, wc.agent_muted, wc.human_handoff_required, wc.handoff_reason FROM public.whatsapp_conversations wc
       WHERE wc.client_id = v.client_id AND wc.company_id = v.company_id AND wc.route_key IN ('barka','muscat')
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) cv ON coalesce(cv.agent_muted, false) = false
        AND NOT (coalesce(cv.human_handoff_required, false) AND coalesce(cv.handoff_reason, '') ~ '^\s*(تفاوض|مشتري جاد)\s*:')
    JOIN LATERAL (
      SELECT max(m.message_timestamp) AS last_in FROM public.whatsapp_messages m
       WHERE m.conversation_id = cv.id AND m.direction = 'inbound'
    ) li ON true
   WHERE v.visit_at > now() - interval '24 hours'
     -- free text needs the client's 24 hour window (with half an hour to spare); past it the visit shows on the staff list
     AND li.last_in > now() - interval '23 hours 30 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.client_id = v.client_id AND f.status = 'sent' AND f.sent_at > now() - interval '24 hours')
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound' AND m.message_type = 'audio'
                      AND m.transcript IS NULL AND m.message_timestamp > now() - interval '48 hours');
$function$;
REVOKE ALL ON FUNCTION public.crm_fast_visit_candidates() FROM PUBLIC, anon, authenticated;

-- 3. the visits of a day (default yesterday, Muscat) whose client got no question from the agent
CREATE OR REPLACE FUNCTION public.crm_visits_unasked(p_day date DEFAULT NULL)
 RETURNS TABLE(viewing_id uuid, client_id uuid, client_name text, phone text, property_title text, visit_at timestamp with time zone,
               viewing_status text, conversation_id uuid, why text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid := public.my_company(); d date := coalesce(p_day, (now() AT TIME ZONE 'Asia/Muscat')::date - 1);
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT vw.id, vw.client_id, cl.name, coalesce(cl.phone_normalized, cl.phone), coalesce(pr.title, pr.area, ''),
         ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat'), vw.status, cv.id,
         CASE
           WHEN f.status IS NULL AND cv.id IS NULL THEN 'ما له محادثة واتساب'
           WHEN f.status IS NULL THEN 'ما انجهز له سؤال (النافذة مسكرة أو المحادثة موقوفة)'
           WHEN f.status = 'awaiting_approval' THEN 'السؤال ينتظر موافقة'
           WHEN f.status IN ('stopped', 'skipped') THEN 'المراجعة قررت ما نسأله: ' || coalesce(f.review_reason, f.error, '')
           WHEN f.status = 'superseded' THEN 'العميل كتب قبل ما ينرسل'
           WHEN f.status = 'failed' THEN 'الإرسال فشل: ' || coalesce(f.error, '')
           ELSE 'الحالة: ' || f.status || coalesce(' ' || f.error, '')
         END
    FROM public.viewings vw
    JOIN public.clients cl ON cl.id = vw.client_id AND cl.company_id = c
    LEFT JOIN public.properties pr ON pr.id = vw.property_id
    LEFT JOIN LATERAL (SELECT wc.id FROM public.whatsapp_conversations wc WHERE wc.client_id = vw.client_id AND wc.company_id = c
                        AND wc.route_key IN ('barka', 'muscat') ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1) cv ON true
    LEFT JOIN LATERAL (SELECT x.status, x.review_reason, x.error FROM public.whatsapp_visit_followups x WHERE x.viewing_id = vw.id
                        ORDER BY x.step, x.created_at DESC LIMIT 1) f ON true
   WHERE vw.company_id = c AND vw.viewing_date = d AND coalesce(vw.archived, false) = false
     AND vw.status IN ('scheduled', 'confirmed', 'done')
     AND crm_repair_private.can_access_client(c, vw.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups s WHERE s.viewing_id = vw.id AND s.status = 'sent')
   ORDER BY 6;
END $function$;
REVOKE ALL ON FUNCTION public.crm_visits_unasked(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_visits_unasked(date) TO authenticated;

-- 4. «📞 سجّل اتصال»: one tap per answer, the person signed in is the caller
CREATE OR REPLACE FUNCTION public.crm_log_call(p_client uuid, p_kind text, p_result text, p_next text, p_note text, p_key uuid)
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

-- today's calls (Muscat day) of the person signed in, against 20; the owner also sees each person
CREATE OR REPLACE FUNCTION public.crm_calls_today()
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
