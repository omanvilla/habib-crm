-- 8 Nov 2026 (Ahmed, R7): a serious buyer / negotiation handoff is sent to Ahmed's private WhatsApp at once, from the
-- branch number of that chat, by the edge function whatsapp-owner-hot-alert. Any source counts (reply agent, approved
-- replies, visit follow-ups) because it fires on the conversation itself.
create or replace function crm_repair_private.owner_hot_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.route_key in ('barka','muscat')
     and NEW.human_handoff_required
     and coalesce(NEW.handoff_reason,'') ~ '^\s*(مشتري جاد|تفاوض)\s*:'
     and (not coalesce(OLD.human_handoff_required,false) or OLD.handoff_reason is distinct from NEW.handoff_reason) then
    perform net.http_post(
      url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-crm-agent',
                   (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
      body := jsonb_build_object('conversation_id', NEW.id),
      timeout_milliseconds := 30000);
  end if;
  return NEW;
exception when others then
  return NEW; -- an alert problem never blocks the conversation update
end $$;

drop trigger if exists crm_owner_hot_alert on public.whatsapp_conversations;
create trigger crm_owner_hot_alert
after update of human_handoff_required, handoff_reason on public.whatsapp_conversations
for each row execute function crm_repair_private.owner_hot_alert();
