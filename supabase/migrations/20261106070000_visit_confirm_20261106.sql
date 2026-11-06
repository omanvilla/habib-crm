-- SQL70 (6 Nov 2026, owner's decision): when the 24 hour window would close before the after-visit follow-up, ask the client to
-- confirm the visit while it is still open. A reply opens a new 24 hours, so the follow-up stays free.
-- It goes at the last moment: within 3 hours of the window closing, or from 8pm when it would close before 9:30am.
-- Only when a reply would still cover the visit, and once per visit. It returns candidates and sends nothing.
CREATE OR REPLACE FUNCTION public.crm_visit_confirm_candidates()
 RETURNS TABLE(viewing_id uuid, company_id uuid, client_id uuid, conversation_id uuid, route_key text, meta_phone_number_id text, phone text, area text, viewing_date date, viewing_time time, visit_at timestamptz, last_in timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH v AS (
    SELECT DISTINCT ON (vw.client_id) vw.id, vw.company_id, vw.client_id, vw.property_id, vw.viewing_date, vw.viewing_time,
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
     AND li.last_in + interval '24 hours' < v.visit_at + interval '90 minutes'
     AND v.visit_at + interval '90 minutes' <= now() + interval '24 hours'
     AND (li.last_in + interval '24 hours' <= now() + interval '3 hours'
          OR (extract(hour FROM now() AT TIME ZONE 'Asia/Muscat') >= 20
              AND li.last_in + interval '24 hours' < (((now() AT TIME ZONE 'Asia/Muscat')::date + 1) + time '09:30') AT TIME ZONE 'Asia/Muscat'))
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'
                      AND m.raw_payload->>'source' = 'visit_confirm' AND m.raw_payload->>'viewing_id' = v.id::text)
     -- a person just wrote to this client: no second message on top
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = cv.id AND m.direction = 'outbound'
                      AND m.actor_type = 'human' AND m.message_timestamp > now() - interval '3 hours');
$function$;

REVOKE ALL ON FUNCTION public.crm_visit_confirm_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_visit_confirm_candidates() TO service_role;
