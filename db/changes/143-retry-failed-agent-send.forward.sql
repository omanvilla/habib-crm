-- SQL143 (prepared 18 Nov 2026, NOT applied: it makes the reply agent send, so it waits for Ahmed's word).
-- What happened: Mody answered «نعم» at 10:09 to the reserved notice; the agent wrote a reply, Meta returned 500 (#131000
-- «Something went wrong», a passing error), the agent tried the other token (400 Authorization Error) and the draft ended
-- «failed / meta_send_failed». Nothing retried it and nobody was told, so the client waited.
-- Now: every 5 minutes, a draft that failed with meta_send_failed in the last 2 hours, whose chat got no outbound message
-- after the client's message and no newer draft, is handed back to the agent once («كمّل يا عقل», resume: it reads the whole
-- chat and answers the client's last message only if nobody did). The draft is marked meta_send_failed_retried, so it is
-- tried once only.
-- Rollback: 143-retry-failed-agent-send.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.retry_failed_agent_sends()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare r record; n integer := 0;
begin
  for r in
    select d.id, d.conversation_id
    from public.whatsapp_reply_drafts d
    join public.whatsapp_messages m on m.id = d.message_id
    where d.status = 'failed' and d.error = 'meta_send_failed'
      and d.created_at > now() - interval '2 hours' and d.created_at < now() - interval '3 minutes'
      and not exists (select 1 from public.whatsapp_messages o where o.conversation_id = d.conversation_id
                      and o.direction = 'outbound' and o.message_timestamp > m.message_timestamp
                      and coalesce(o.delivery_status, '') <> 'failed')
      and not exists (select 1 from public.whatsapp_reply_drafts d2 where d2.conversation_id = d.conversation_id and d2.created_at > d.created_at)
    order by d.created_at
    limit 5
  loop
    update public.whatsapp_reply_drafts set error = 'meta_send_failed_retried' where id = r.id and error = 'meta_send_failed';
    perform net.http_post(
      url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-reply-agent',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-crm-agent', (select decrypted_secret from vault.decrypted_secrets where name = 'crm_reply_agent')),
      body := jsonb_build_object('resume', true, 'conversation_id', r.conversation_id),
      timeout_milliseconds := 120000);
    n := n + 1;
  end loop;
  return n;
end
$function$;

REVOKE ALL ON FUNCTION crm_repair_private.retry_failed_agent_sends() FROM PUBLIC;

SELECT cron.schedule('crm-retry-failed-agent-sends', '*/5 * * * *', $$select crm_repair_private.retry_failed_agent_sends()$$);
