-- Rollback of SQL95: the approved-but-held study waits for Ahmed's «ارسل الحين» again (the SQL94 body of the trigger function),
-- and the 30-minute check stops.
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_held') THEN PERFORM cron.unschedule('owner_price_study_held'); END IF;
END $$;

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if NEW.direction <> 'inbound' or NEW.conversation_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and not (NEW.transcript is not null and OLD.transcript is null) then return NEW; end if;
  if exists (select 1 from public.owner_price_studies s
              where s.conversation_id = NEW.conversation_id
                and (s.status = 'waiting_owner'
                     or (s.status = 'sent' and s.owner_reaction is null and s.sent_at > now() - interval '14 days'))) then
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'owner_inbound', 'conversation_id', NEW.conversation_id, 'message_id', NEW.id));
  elsif TG_OP = 'INSERT' and NEW.message_type in ('image', 'document', 'video') and NEW.media_id is not null
     and exists (select 1 from public.whatsapp_conversations c
                  where c.id = NEW.conversation_id and c.human_handoff_required and coalesce(c.handoff_reason, '') ~ '^\s*دراسة\s*سعر') then
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'save_docs', 'conversation_id', NEW.conversation_id));
  end if;
  return NEW;
exception when others then
  return NEW; -- never block message saving
end $function$;
