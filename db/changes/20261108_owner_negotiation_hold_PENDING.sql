-- 8 Nov 2026 (Ahmed): the reply agent and the follow-ups never message a customer or owner who is
-- negotiating with Ahmed, or whom Ahmed answered by hand.
-- Cause found on Tasnim (barka): a negotiation handoff ("تفاوض: ...") was closed automatically by
-- trg_clear_handoff_on_human_reply as soon as a staff message was saved, so the agent spoke again.
--
-- 1. A hard handoff (تفاوض / مشتري جاد / دراسة سعر) is no longer closed by a staff reply and no longer
--    suppressed when staff already replied. Ahmed closes it himself from the inbox.
-- 2. public.crm_conversation_hold(conversation) gives one answer for every sender (agent, visit
--    follow-ups, outreach): 'negotiation' | 'manual_reply' (a person from the office typed a message in
--    the last 24 hours) | 'muted' | null.
-- 3. Tasnim's negotiation handoff is reopened.

create or replace function crm_repair_private.is_hard_handoff(p_reason text)
returns boolean language sql immutable as $$
  select coalesce(p_reason, '') ~ '^\s*(تفاوض|مشتري جاد|دراسة سعر)\s*:'
$$;

create or replace function crm_repair_private.clear_handoff_on_human_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.direction = 'outbound' and NEW.actor_type = 'human' and NEW.conversation_id is not null then
    update public.whatsapp_conversations c
       set human_handoff_required = false,
           handoff_reason = '[أُغلق تلقائياً: رد الموظف] ' || coalesce(c.handoff_reason,''),
           handoff_updated_at = now()
     where c.id = NEW.conversation_id
       and c.company_id = NEW.company_id
       and c.human_handoff_required
       and not crm_repair_private.is_hard_handoff(c.handoff_reason)
       and coalesce(NEW.message_timestamp, NEW.created_at) >= coalesce(c.last_inbound_at, '-infinity'::timestamptz);
  end if;
  return NEW;
exception when others then
  return NEW; -- never block message saving
end $$;

create or replace function crm_repair_private.suppress_handoff_if_human_already_replied()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.human_handoff_required and not coalesce(OLD.human_handoff_required,false)
     and not crm_repair_private.is_hard_handoff(NEW.handoff_reason)
     and exists (select 1 from public.whatsapp_messages m
                  where m.conversation_id = NEW.id and m.company_id = NEW.company_id
                    and m.direction = 'outbound' and m.actor_type = 'human'
                    and coalesce(m.message_timestamp, m.created_at) >= coalesce(NEW.last_inbound_at, '-infinity'::timestamptz)) then
    NEW.human_handoff_required := false;
    NEW.handoff_reason := OLD.handoff_reason;
    NEW.handoff_updated_at := OLD.handoff_updated_at;
  end if;
  return NEW;
end $$;

create or replace function public.crm_conversation_hold(p_conversation uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when c.agent_muted then 'muted'
    when c.human_handoff_required and crm_repair_private.is_hard_handoff(c.handoff_reason) then 'negotiation'
    when exists (select 1 from public.whatsapp_messages m
                  where m.conversation_id = c.id and m.direction = 'outbound' and m.actor_type = 'human'
                    and m.message_timestamp > now() - interval '24 hours') then 'manual_reply'
  end
  from public.whatsapp_conversations c where c.id = p_conversation
$$;
revoke all on function public.crm_conversation_hold(uuid) from public, anon, authenticated;
grant execute on function public.crm_conversation_hold(uuid) to service_role;

update public.whatsapp_conversations
   set human_handoff_required = true,
       handoff_reason = regexp_replace(handoff_reason, '^(\[أُغلق تلقائياً: رد الموظف\]\s*)+', ''),
       handoff_updated_at = now(), updated_at = now()
 where id = '6698ed95-ebd8-41d2-8b83-6cd44d2850da' and not human_handoff_required;
