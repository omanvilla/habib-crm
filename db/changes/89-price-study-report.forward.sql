-- SQL89 (11 Nov 2026, Ahmed): every new «دراسة سعر:» handoff sends the full report to his private WhatsApp from the branch
-- number (whatsapp-owner-hot-alert action price_study: details, number, the owner offer, the owner's words, his images and
-- documents, separators). The hot-alert part of the trigger is unchanged. Rollback: 89-price-study-report.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('crm_repair_private.owner_hot_alert'::regproc)) <> 'e25b8da4a5beb3c5589c6851dfe9d52a' THEN
    RAISE EXCEPTION 'SQL89 refused: owner_hot_alert changed since 11 Nov 2026';
  END IF;
END $$;

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
  -- price study: a new «دراسة سعر» handoff (not a rewording of the same open one) sends the report once
  if NEW.route_key in ('barka','muscat')
     and NEW.human_handoff_required
     and coalesce(NEW.handoff_reason,'') ~ '^\s*دراسة\s*سعر'
     and (not coalesce(OLD.human_handoff_required,false) or coalesce(OLD.handoff_reason,'') !~ '^\s*دراسة\s*سعر') then
    perform net.http_post(
      url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-crm-agent',
                   (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
      body := jsonb_build_object('action', 'price_study', 'conversation_id', NEW.id),
      timeout_milliseconds := 120000);
  end if;
  return NEW;
exception when others then
  return NEW;
end $function$;
