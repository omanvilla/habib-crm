-- SQL136 (18 Nov 2026, Ahmed's review of conflicting decisions, plan section 2 «المتابعات», «نعم موافق»).
-- What the database prepares for the follow-ups (the sending rules live in whatsapp-visit-followup-auto / whatsapp-outreach):
--   R40 «نوقفها كلها»: no follow-up of any kind about a property that is gone (crm_repair_private.property_is_gone, SQL134:
--       sold, reserved, withdrawn or archived): the after-visit question (crm_fast_visit_candidates, was sold/reserved and only
--       for a visit that did not happen), the 1/3/7/30 follow-ups (crm_queue_visit_followups, had no property check) and the
--       visit confirmation (crm_visit_confirm_candidates, was sold/reserved).
--   R37: a chat handed to a person (open handoff, any reason) gets no after-visit question until it is handed back (it held
--       only a negotiation handoff before). A chat a person only typed in still gets it (R47).
--   R43 «2 للكل»: two unanswered visit follow-ups stop them (was 3); error no_response_2.
--   R72 «إيوا طبقها»: after the first week from the visit, at most one follow-up in 7 days (was 2 days).
--   R50: after the one «تحب نحدد لك موعد ثاني ؟» (review_reason «(R50)») is sent and not answered, nothing more is prepared.
--   R46 «نوقف متابعات المستثمرين»: no follow-up to an investor (SQL91's investor lane) until 12 Feb 2027. New
--       crm_followup_investor_paused(): the edge functions ask it too. Booked meetings and their confirmation stay.
--   R45 unchanged: a visit opt-out (whatsapp_followup_optouts) still does not stop the weekly request follow-up.
-- Nothing here closes or changes an existing row. Rollback: 136-followups-review.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_fast_visit_candidates()'::regprocedure)) <> '46ce4e04c5a362ca198b39cc2133466d' THEN
    RAISE EXCEPTION 'SQL136 refused: crm_fast_visit_candidates changed since SQL132';
  END IF;
  IF md5(pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure)) <> '4cfbfbfc51d5bc6df6c0409465137a8b' THEN
    RAISE EXCEPTION 'SQL136 refused: crm_queue_visit_followups changed since SQL63';
  END IF;
  IF md5(pg_get_functiondef('public.crm_visit_confirm_candidates()'::regprocedure)) <> '6378dc98cd144d61872babea5f712705' THEN
    RAISE EXCEPTION 'SQL136 refused: crm_visit_confirm_candidates changed since SQL132';
  END IF;
  IF md5(pg_get_functiondef('crm_repair_private.followup_lane(uuid,uuid,text,text)'::regprocedure)) <> 'af75f7c2f478e073974baba7cf2447b6' THEN
    RAISE EXCEPTION 'SQL136 refused: followup_lane changed since SQL105';
  END IF;
END $$;

-- R46: true while the investor follow-ups are paused (until 12 Feb 2027, Muscat time) and this client / chat / text is in the
-- investor lane of the daily list (SQL91 / SQL105). Service role only (the edge functions and the functions below).
CREATE OR REPLACE FUNCTION public.crm_followup_investor_paused(p_client uuid, p_conversation uuid, p_route text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT now() < timestamptz '2027-02-12 00:00:00+04'
     AND crm_repair_private.followup_lane(p_client, p_conversation, p_route, p_text) = 'investor'
$function$;
REVOKE ALL ON FUNCTION public.crm_followup_investor_paused(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_followup_investor_paused(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_fast_visit_candidates()
 RETURNS TABLE(viewing_id uuid, company_id uuid, client_id uuid, request_id uuid, conversation_id uuid, route_key text, visit_at timestamp with time zone, last_in timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH v AS (
    SELECT DISTINCT ON (vw.client_id) vw.id, vw.company_id, vw.client_id, vw.request_id, vw.property_id,
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
        -- R37: a chat handed to a person (any handoff) gets nothing until it is handed back
        AND coalesce(cv.human_handoff_required, false) = false
    JOIN LATERAL (
      SELECT max(m.message_timestamp) AS last_in FROM public.whatsapp_messages m
       WHERE m.conversation_id = cv.id AND m.direction = 'inbound'
    ) li ON true
   WHERE v.visit_at > now() - interval '24 hours'
     -- R40: nothing about a property that is gone (sold, reserved, withdrawn, archived), done visit or not
     AND NOT EXISTS (SELECT 1 FROM public.properties px WHERE px.id = v.property_id AND crm_repair_private.property_is_gone(px.status, px.archived))
     -- R46: no investor follow-up until 12 Feb 2027
     AND NOT public.crm_followup_investor_paused(v.client_id, cv.id, cv.route_key, NULL)
     -- free text needs the client's 24 hour window (with half an hour to spare); past it the visit shows on the staff list
     AND li.last_in > now() - interval '23 hours 30 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.client_id = v.client_id AND f.status = 'sent' AND f.sent_at > now() - interval '24 hours')
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound' AND m.message_type = 'audio'
                      AND m.transcript IS NULL AND m.message_timestamp > now() - interval '48 hours');
$function$;

CREATE OR REPLACE FUNCTION public.crm_queue_visit_followups(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c record; o record;
  v_hour int := extract(hour FROM (now() AT TIME ZONE 'Asia/Muscat'));
  v_offsets int[] := ARRAY[1, 3, 7, 30];
  v_last_in timestamptz; v_last_human timestamptz; v_anchor timestamptz;
  v_since_anchor int; v_total int; v_unanswered int; v_last_sent timestamptz; v_due timestamptz;
  v_queued int := 0; v_stopped int := 0; v_superseded int := 0;
BEGIN
  IF v_hour < 9 OR v_hour >= 21 THEN RETURN jsonb_build_object('ok', true, 'reason', 'outside_hours'); END IF;
  FOR c IN
    WITH v AS (
      SELECT DISTINCT ON (vw.client_id) vw.id AS viewing_id, vw.company_id, vw.client_id, vw.request_id, vw.property_id,
             ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') AS visit_at
        FROM public.viewings vw
       WHERE coalesce(vw.archived, false) = false
         AND vw.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date - 60
         AND ((vw.status = 'done' AND (vw.viewing_date >= date '2026-11-02' OR (vw.created_via = 'whatsapp_ai' AND vw.auto_confidence IS NULL)))
           OR (vw.status IN ('scheduled','confirmed','postponed')
               AND vw.viewing_date < (now() AT TIME ZONE 'Asia/Muscat')::date
               AND vw.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date - 30
               AND NOT EXISTS (SELECT 1 FROM public.viewings nx WHERE nx.client_id = vw.client_id AND coalesce(nx.archived, false) = false
                                 AND nx.status IN ('scheduled','confirmed') AND nx.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date)))
       ORDER BY vw.client_id, vw.viewing_date DESC, vw.viewing_time DESC NULLS LAST
    )
    SELECT v.*, cv.id AS conversation_id, cv.route_key, coalesce(cv.human_handoff_required, false) AS handoff
      FROM v
      JOIN public.clients cl ON cl.id = v.client_id AND coalesce(cl.archived, false) = false AND coalesce(cl.phone, '') <> ''
      JOIN LATERAL (
        SELECT wc.id, wc.route_key, wc.human_handoff_required FROM public.whatsapp_conversations wc
         WHERE wc.client_id = v.client_id AND wc.company_id = v.company_id AND wc.route_key IN ('barka','muscat')
         ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
      ) cv ON true
     WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups s WHERE s.viewing_id = v.viewing_id AND s.status = 'stopped')
       -- R40: nothing about a property that is gone (sold, reserved, withdrawn, archived)
       AND NOT EXISTS (SELECT 1 FROM public.properties px WHERE px.id = v.property_id AND crm_repair_private.property_is_gone(px.status, px.archived))
       -- R46: no investor follow-up until 12 Feb 2027
       AND NOT public.crm_followup_investor_paused(v.client_id, cv.id, cv.route_key, NULL)
  LOOP
    SELECT max(m.message_timestamp) FILTER (WHERE m.direction = 'inbound'),
           max(m.message_timestamp) FILTER (WHERE m.direction = 'outbound' AND m.actor_type = 'human')
      INTO v_last_in, v_last_human
      FROM public.whatsapp_messages m WHERE m.conversation_id = c.conversation_id;
    FOR o IN SELECT * FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status = 'awaiting_approval' LOOP
      IF coalesce(v_last_in, '-infinity') > o.created_at OR coalesce(v_last_human, '-infinity') > o.created_at THEN
        UPDATE public.whatsapp_visit_followups SET status = 'superseded', updated_at = now() WHERE id = o.id;
        v_superseded := v_superseded + 1;
      END IF;
    END LOOP;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status IN ('awaiting_approval','sending'));
    IF EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = c.conversation_id AND m.direction = 'inbound'
                AND m.message_timestamp > c.visit_at
                AND coalesce(m.transcript, m.body, '') ~* '(ما ابي|ما أبي|ما ابغى|ما أبغى|مو مهتم|ما مهتم|غير مهتم|لا تراسل|لا ترسل|وقف المتابعة|stop|unsubscribe)') THEN
      INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, anchor_at, due_at, error)
      VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, 1, 'stopped', '-', c.visit_at, now(), 'customer_declined');
      IF c.request_id IS NOT NULL THEN
        INSERT INTO public.whatsapp_followup_optouts (request_id, company_id, client_id, reason)
        VALUES (c.request_id, c.company_id, c.client_id, 'visit_followup_declined') ON CONFLICT (request_id) DO NOTHING;
      END IF;
      v_stopped := v_stopped + 1; CONTINUE;
    END IF;
    SELECT count(*) FILTER (WHERE f.status = 'sent' AND f.sent_at > coalesce(v_last_in, '-infinity')), count(*),
           max(coalesce(f.sent_at, f.decided_at))
      INTO v_unanswered, v_total, v_last_sent
      FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status IN ('sent','rejected');
    -- R43 (Ahmed 18 Nov «2 للكل»): two unanswered follow-ups stop them, as for the requests
    IF v_unanswered >= 2 THEN
      INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, anchor_at, due_at, error)
      VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, least(v_total, 4), 'stopped', '-', c.visit_at, now(), 'no_response_2');
      IF c.request_id IS NOT NULL THEN
        INSERT INTO public.whatsapp_followup_optouts (request_id, company_id, client_id, reason)
        VALUES (c.request_id, c.company_id, c.client_id, 'visit_followup_no_response') ON CONFLICT (request_id) DO NOTHING;
      END IF;
      v_stopped := v_stopped + 1; CONTINUE;
    END IF;
    CONTINUE WHEN v_total >= 4 OR c.handoff;
    -- R50: the one «تحب نحدد لك موعد ثاني ؟» went and was not answered: nothing more
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status = 'sent'
                           AND coalesce(f.review_reason, '') ~ '\(R50\)' AND f.sent_at > coalesce(v_last_in, '-infinity'));
    CONTINUE WHEN coalesce(v_last_in, '-infinity') > now() - interval '48 hours';
    -- R72 (Ahmed 18 Nov «إيوا طبقها»): after the first week from the visit, one follow-up in 7 days at most
    CONTINUE WHEN coalesce(v_last_sent, '-infinity') > now() - CASE WHEN now() >= c.visit_at + interval '7 days' THEN interval '7 days' ELSE interval '2 days' END;
    v_anchor := greatest(c.visit_at, coalesce(v_last_human, c.visit_at));
    SELECT count(*) INTO v_since_anchor FROM public.whatsapp_visit_followups f
     WHERE f.viewing_id = c.viewing_id AND f.status IN ('sent','rejected') AND coalesce(f.sent_at, f.decided_at) > v_anchor;
    CONTINUE WHEN v_since_anchor >= 4;
    v_due := v_anchor + make_interval(days => v_offsets[v_since_anchor + 1]);
    CONTINUE WHEN now() < v_due;
    INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, template_name, anchor_at, due_at)
    VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, v_total + 1, 'awaiting_approval',
            public.crm_visit_followup_text(v_total + 1, c.route_key), public.crm_visit_followup_template(v_total + 1, c.route_key), v_anchor, v_due);
    v_queued := v_queued + 1;
    EXIT WHEN v_queued >= greatest(1, least(coalesce(p_limit, 20), 50));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'queued', v_queued, 'stopped', v_stopped, 'superseded', v_superseded);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_visit_confirm_candidates()
 RETURNS TABLE(viewing_id uuid, company_id uuid, client_id uuid, conversation_id uuid, route_key text, meta_phone_number_id text, phone text, area text, viewing_date date, viewing_time time without time zone, visit_at timestamp with time zone, last_in timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH v AS (
    SELECT DISTINCT ON (vw.client_id) vw.id, vw.company_id, vw.client_id, vw.property_id, vw.viewing_date, vw.viewing_time, vw.created_at,
           ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') AS visit_at
      FROM public.viewings vw
     WHERE coalesce(vw.archived, false) = false
       AND vw.status IN ('scheduled','confirmed')
       AND ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') > now()
     ORDER BY vw.client_id, vw.viewing_date, vw.viewing_time NULLS LAST
  )
  SELECT v.id, v.company_id, v.client_id, cv.id, cv.route_key, cv.meta_phone_number_id, coalesce(cl.phone_normalized, cl.phone), p.area, v.viewing_date, v.viewing_time, v.visit_at, li.last_in
    FROM v
    JOIN public.clients cl ON cl.id = v.client_id AND coalesce(cl.archived, false) = false
         AND coalesce(cl.followup_suppressed, false) = false AND coalesce(cl.phone, '') <> ''
    LEFT JOIN public.properties p ON p.id = v.property_id
    JOIN LATERAL (
      SELECT wc.id, wc.route_key, wc.meta_phone_number_id, wc.agent_muted, wc.human_handoff_required FROM public.whatsapp_conversations wc
       WHERE wc.client_id = v.client_id AND wc.company_id = v.company_id AND wc.route_key IN ('barka','muscat')
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) cv ON coalesce(cv.agent_muted, false) = false AND coalesce(cv.human_handoff_required, false) = false
    JOIN LATERAL (
      SELECT max(m.message_timestamp) AS last_in FROM public.whatsapp_messages m
       WHERE m.conversation_id = cv.id AND m.direction = 'inbound'
    ) li ON true
   WHERE li.last_in + interval '24 hours' > now() + interval '10 minutes'
     -- R40 (SQL136): never for a property that is gone (sold, reserved, withdrawn, archived)
     AND NOT crm_repair_private.property_is_gone(p.status, p.archived)
     AND (
       -- R85: one hour before the visit
       (now() >= v.visit_at - interval '60 minutes' AND now() < v.visit_at - interval '15 minutes'
        AND v.created_at < now() - interval '60 minutes' AND li.last_in < now() - interval '30 minutes')
       -- SQL70: the window closes before that hour, so it goes at the last moment of the window
       OR (li.last_in + interval '24 hours' < v.visit_at - interval '60 minutes'
           AND li.last_in + interval '24 hours' < v.visit_at + interval '90 minutes'
           AND v.visit_at + interval '90 minutes' <= now() + interval '24 hours'
           AND (li.last_in + interval '24 hours' <= now() + interval '3 hours'
                OR (extract(hour FROM now() AT TIME ZONE 'Asia/Muscat') >= 20
                    AND li.last_in + interval '24 hours' < (((now() AT TIME ZONE 'Asia/Muscat')::date + 1) + time '09:30') AT TIME ZONE 'Asia/Muscat')))
     )
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'
                      AND m.raw_payload->>'source' = 'visit_confirm' AND m.raw_payload->>'viewing_id' = v.id::text)
     -- a person just wrote to this client: no second message on top
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'
                      AND m.actor_type = 'human' AND m.message_timestamp > now() - interval '3 hours');
$function$;

-- grants stay as they were (CREATE OR REPLACE keeps them): service_role only on the three functions above
