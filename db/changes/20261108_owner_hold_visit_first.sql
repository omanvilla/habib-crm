-- 8 Nov 2026 — Ahmed's decisions after the Tasnim case (see docs/agent-rules.md, rules R1–R3).
-- R1  When Ahmed (or anyone in the office) types in a chat, the reply agent and every follow-up stay out of it
--     until Ahmed hands it back («↩️ رجّعها للعقل» / «✓ تمت المعالجة» in the inbox). Replaces the 6 Nov rule
--     "after Ahmed answers, the agent carries on after 30 seconds". A follow-up he sent from the daily list
--     (visit follow-up send_mode=owner, outreach reason=owner_sent) does not count as taking the chat.
-- R3  A hard handoff (تفاوض / مشتري جاد / دراسة سعر) is never closed by a staff reply; Ahmed closes it himself.
-- Start point: manual replies from the last 24 hours count, older ones do not (otherwise every chat Ahmed ever
-- answered would go quiet at once).

alter table public.whatsapp_conversations add column if not exists agent_returned_at timestamptz;
update public.whatsapp_conversations set agent_returned_at = now() - interval '24 hours' where agent_returned_at is null;
alter table public.whatsapp_conversations alter column agent_returned_at set default now();
comment on column public.whatsapp_conversations.agent_returned_at is
  'Ahmed handed the chat back to the reply agent at this time (R1). A human message after it keeps the agent and follow-ups out.';

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
       and not crm_repair_private.is_hard_handoff(c.handoff_reason)   -- R3
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
     and not crm_repair_private.is_hard_handoff(NEW.handoff_reason)    -- R3
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

-- One answer for the reply agent, the visit follow-ups, outreach and the inbox banner.
-- 'muted' | 'negotiation' | 'manual_reply' | null (the agent may answer)
create or replace function public.crm_chat_hold(p_conversation uuid)
returns text language sql stable security definer set search_path = public as $$
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
$$;
revoke all on function public.crm_chat_hold(uuid) from public, anon, authenticated;
grant execute on function public.crm_chat_hold(uuid) to service_role;
-- Tasnim (barka) is not reopened as a negotiation: she has not visited yet (R2). Ahmed answered her by hand
-- today, so R1 already keeps the agent out of her chat until he hands it back.
