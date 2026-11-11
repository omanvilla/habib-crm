-- SQL95 (11 Nov 2026, Ahmed's test): a study he approved while the owner's 24-hour window was closed and the template was not
-- approved by Meta yet stayed «approved, not sent» until he pressed again. Now it goes by itself: when the owner writes (the
-- window opens), and when Meta approves the template (a check every 30 minutes, only while such a study waits).
-- Nothing new reaches an owner without Ahmed's approval: only studies already in status «approved» are picked, and the
-- test / off switch of SQL94 is checked again at send time. Rollback: 95-price-study-held.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('crm_repair_private.price_study_on_message'::regproc)) <> '89e265dfc5698e93186091d97b35dbbe' THEN
    RAISE EXCEPTION 'SQL95 refused: price_study_on_message changed since SQL94';
  END IF;
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
                     or (s.status = 'approved' and s.send_error = 'template_not_approved')
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

-- every 30 minutes, and only while an approved study waits for the template: ask the function to try again
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_held') THEN PERFORM cron.unschedule('owner_price_study_held'); END IF;
END $$;
SELECT cron.schedule('owner_price_study_held', '*/30 * * * *', $job$
  select crm_repair_private.price_study_call('{"action":"held_tick"}'::jsonb, 150000)
   where exists (select 1 from public.owner_price_studies s where s.status = 'approved' and s.send_error = 'template_not_approved');
$job$);
