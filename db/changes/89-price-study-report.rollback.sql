-- Rollback of SQL89: the trigger only sends the hot alerts again.
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION crm_repair_private.owner_hot_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.route_key in ('barka','muscat')
     and NEW.human_handoff_required
     and coalesce(NEW.handoff_reason,'') ~ '^\s*(مشتري جاد|تفاوض|اجتماع)\s*:'
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
  return NEW;
end $function$;
