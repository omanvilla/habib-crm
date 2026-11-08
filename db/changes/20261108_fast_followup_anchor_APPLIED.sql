-- 8 Nov 2026 (Ahmed): the 1.5 h after-visit question must also reach a client who wrote "going now" / "ok" up to 3 h after
-- the recorded visit time (the time is often a guess). The question is due 1.5 h after his last message.
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
  SELECT v.id, v.company_id, v.client_id, v.request_id, cv.id, cv.route_key, greatest(v.visit_at, li.last_in), li.last_in
    FROM v
    JOIN public.clients cl ON cl.id = v.client_id AND coalesce(cl.archived, false) = false
         AND coalesce(cl.followup_suppressed, false) = false AND coalesce(cl.phone, '') <> ''
    JOIN LATERAL (
      SELECT wc.id, wc.route_key, wc.agent_muted, wc.human_handoff_required FROM public.whatsapp_conversations wc
       WHERE wc.client_id = v.client_id AND wc.company_id = v.company_id AND wc.route_key IN ('barka','muscat')
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) cv ON coalesce(cv.agent_muted, false) = false AND coalesce(cv.human_handoff_required, false) = false
    JOIN LATERAL (
      SELECT max(m.message_timestamp) AS last_in FROM public.whatsapp_messages m
       WHERE m.conversation_id = cv.id AND m.direction = 'inbound'
    ) li ON true
   WHERE v.visit_at > now() - interval '24 hours'
     AND li.last_in > now() - interval '23 hours 30 minutes'
     AND li.last_in <= v.visit_at + interval '3 hours'
     AND greatest(v.visit_at, li.last_in) <= now() - interval '90 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'
                      AND m.actor_type = 'human' AND m.message_timestamp > v.visit_at + interval '30 minutes')
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.client_id = v.client_id AND f.status = 'sent' AND f.sent_at > now() - interval '24 hours')
     AND NOT EXISTS (SELECT 1 FROM public.viewings nx WHERE nx.client_id = v.client_id AND coalesce(nx.archived, false) = false AND nx.status IN ('scheduled','confirmed')
                      AND ((nx.viewing_date + coalesce(nx.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') > now() - interval '90 minutes')
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'inbound' AND m.message_type = 'audio'
                      AND m.transcript IS NULL AND m.message_timestamp > now() - interval '48 hours');
$function$;
