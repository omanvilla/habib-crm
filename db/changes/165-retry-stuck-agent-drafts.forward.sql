-- SQL165 (27 Nov 2026, Ahmed's note «طلب اللوكيشن وبيروح يزور ليش ما رسلتله ؟», Achar Delight df33354a).
-- What happened: the client asked at 11:12 Muscat for the location (visit today at 5). The reply agent claimed the draft
-- (pending, empty) and its run died at 150s with 546 while the database was choked (07:14Z). Nothing retried it: SQL143
-- only retries meta_send_failed, and «كمّل يا عقل» ignores a draft that is still «pending» (already_processing). The empty
-- draft sat in «ردود تنتظر موافقتك» as «المحرك يقترح عدم الرد» and the client got nothing.
-- Now: the same 5-minute job also takes a draft stuck «pending» with no messages and no analysis (the run never finished),
-- 6 minutes to 2 hours old (an agent run is cut at 150s), whose chat got no outbound message after the client's message and
-- no newer draft. It is marked failed/agent_run_stuck and handed back to the agent once (resume). The resumed run writes
-- analysis.resumed, so a draft is never retried twice. The agent decides again whether to answer (mute, handoff, office).
-- Rollback: 165-retry-stuck-agent-drafts.rollback.sql (puts back the SQL143 function).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.retry_failed_agent_sends()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare r record; n integer := 0;
begin
  for r in
    select d.id, d.conversation_id, d.status as st
    from public.whatsapp_reply_drafts d
    join public.whatsapp_messages m on m.id = d.message_id
    where ((d.status = 'failed' and d.error = 'meta_send_failed' and d.created_at < now() - interval '3 minutes')
        or (d.status = 'pending' and coalesce(d.analysis, '{}'::jsonb) = '{}'::jsonb
            and coalesce(cardinality(d.reply_messages), 0) = 0 and d.created_at < now() - interval '6 minutes'))
      and d.created_at > now() - interval '2 hours'
      and not exists (select 1 from public.whatsapp_messages o where o.conversation_id = d.conversation_id
                      and o.direction = 'outbound' and o.message_timestamp > m.message_timestamp
                      and coalesce(o.delivery_status, '') <> 'failed')
      and not exists (select 1 from public.whatsapp_reply_drafts d2 where d2.conversation_id = d.conversation_id and d2.created_at > d.created_at)
    order by d.created_at
    limit 5
  loop
    if r.st = 'pending' then
      update public.whatsapp_reply_drafts set status = 'failed', error = 'agent_run_stuck'
       where id = r.id and status = 'pending' and coalesce(analysis, '{}'::jsonb) = '{}'::jsonb;
      if not found then continue; end if;
    else
      update public.whatsapp_reply_drafts set error = 'meta_send_failed_retried' where id = r.id and error = 'meta_send_failed';
      if not found then continue; end if;
    end if;
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
