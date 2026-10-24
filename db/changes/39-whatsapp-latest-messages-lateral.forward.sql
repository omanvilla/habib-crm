-- SQL39: crm_whatsapp_latest_messages reads only the newest visible message per
-- conversation instead of every message in up to 300 conversations.
--
-- The old DISTINCT ON form fetched and RLS-checked every message of every
-- requested conversation (~1 s for the WhatsApp list's 100 conversations) and
-- then discarded all but one. The LATERAL ... LIMIT 1 form walks
-- whatsapp_messages_conversation_time_idx and stops at the first row that passes
-- the caller's RLS, which is the same "newest visible message" by
-- (message_timestamp DESC, id DESC). Still SECURITY INVOKER; same signature,
-- columns, conversation join, active-profile guard and 300-id cap.
-- Trial (rolled back): identical output for owner and agent on their top 100
-- conversations and on all company conversation ids; 1,088 → 39 ms (owner),
-- 1,017 → 65 ms (agent).
CREATE OR REPLACE FUNCTION public.crm_whatsapp_latest_messages(p_conversation_ids uuid[])
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT to_jsonb(latest) FROM (
    SELECT l.*
    FROM (SELECT DISTINCT x.cid FROM unnest(p_conversation_ids[1:300]) AS x(cid)) ids
    JOIN public.whatsapp_conversations c ON c.id = ids.cid
    CROSS JOIN LATERAL (
      SELECT m.conversation_id,m.request_id,m.direction,m.actor_type,m.body,m.transcript,
             m.message_type,m.message_timestamp,m.delivery_status,m.automation_result
      FROM public.whatsapp_messages m
      WHERE m.conversation_id = c.id AND m.company_id = c.company_id
      ORDER BY m.message_timestamp DESC, m.id DESC
      LIMIT 1
    ) l
    WHERE auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE)
    ORDER BY l.conversation_id
  ) latest;
$function$;
