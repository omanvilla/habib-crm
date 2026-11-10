-- RECORD ONLY (10 Nov 2026): the R1/R3 hold as it is live, copied from the database because no file in the
-- repository held it (applied 8 Nov as owner_hold_visit_first_20261108). Do not run; it changes nothing.
-- Used by the reply agent, visit follow-ups (R13), outreach and crm_paused_chats (SQL75).

CREATE OR REPLACE FUNCTION crm_repair_private.is_hard_handoff(p_reason text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_reason, '') ~ '^\s*(تفاوض|مشتري جاد|دراسة سعر)\s*:'
$function$;

CREATE OR REPLACE FUNCTION public.crm_chat_hold(p_conversation uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when c.agent_muted then 'muted'
    when c.human_handoff_required and crm_repair_private.is_hard_handoff(c.handoff_reason) then 'negotiation'
    when exists (
      select 1 from public.whatsapp_messages m
       where m.conversation_id = c.id and m.direction = 'outbound' and m.actor_type = 'human'
         and m.message_timestamp > coalesce(c.agent_returned_at, '-infinity'::timestamptz)
         and not exists (select 1 from public.whatsapp_visit_followups f
                          where f.client_id = c.client_id and f.send_mode = 'owner'
                            and f.sent_at between m.message_timestamp - interval '10 minutes' and m.message_timestamp + interval '10 minutes')
         and not exists (select 1 from public.whatsapp_outreach_queue q
                          where q.client_id = c.client_id and q.reason = 'owner_sent'
                            and q.sent_at between m.message_timestamp - interval '10 minutes' and m.message_timestamp + interval '10 minutes')
    ) then 'manual_reply'
  end
  from public.whatsapp_conversations c where c.id = p_conversation
$function$;
