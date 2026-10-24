-- SQL39 rollback: restore the original DISTINCT ON definition.
CREATE OR REPLACE FUNCTION public.crm_whatsapp_latest_messages(p_conversation_ids uuid[])
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT to_jsonb(latest) FROM (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,m.request_id,m.direction,m.actor_type,m.body,m.transcript,
      m.message_type,m.message_timestamp,m.delivery_status,m.automation_result
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
    WHERE m.conversation_id=ANY(p_conversation_ids[1:300]) AND auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE)
    ORDER BY m.conversation_id,m.message_timestamp DESC,m.id DESC
  ) latest;
$function$;
