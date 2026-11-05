-- Ahmed's notes from the CRM ("ملاحظة لـ Claude", or an instruction he marks to keep) teach the reply agent
-- right away: open notes marked apply_now are written into whatsapp_agent_prompts key 'lessons', which the
-- agent reads on every reply. When Claude folds a note into the brain, the note is set to done and drops out.
alter table public.crm_owner_notes add column if not exists apply_now boolean not null default true;

create or replace function crm_repair_private.rebuild_agent_lessons() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare txt text;
begin
  select string_agg(line, E'\n' order by created_at) into txt from (
    select n.created_at, '- [' || to_char(n.created_at at time zone 'Asia/Muscat','DD/MM') || '] ' || n.note
      || coalesce(' (المحادثة مع ' || coalesce(nullif(cl.name,''), w.customer_name, 'عميل')
        || coalesce(' | آخر كلام العميل: ' || (select left(coalesce(m.transcript,m.body),160) from whatsapp_messages m where m.conversation_id=n.conversation_id and m.direction='inbound' and m.message_timestamp<=n.created_at order by m.message_timestamp desc limit 1),'')
        || coalesce(' | آخر رد منا: ' || (select left(m.body,160) from whatsapp_messages m where m.conversation_id=n.conversation_id and m.direction='outbound' and m.message_timestamp<=n.created_at order by m.message_timestamp desc limit 1),'')
        || ')', '')
      || coalesce(' (الرد المقترح وقتها: ' || (select left(array_to_string(d.reply_messages,' / '),200) from whatsapp_reply_drafts d where d.id=n.draft_id) || ')','') line
    from crm_owner_notes n
    left join whatsapp_conversations w on w.id = n.conversation_id
    left join clients cl on cl.id = w.client_id
    where n.status = 'open' and n.apply_now and n.created_at > now() - interval '90 days'
    order by n.created_at desc limit 40) x;
  insert into whatsapp_agent_prompts(key, content, updated_at) values ('lessons', coalesce(txt,''), now())
    on conflict (key) do update set content = excluded.content, updated_at = now();
  return null;
end $f$;

drop trigger if exists trg_rebuild_agent_lessons on public.crm_owner_notes;
create trigger trg_rebuild_agent_lessons after insert or update or delete on public.crm_owner_notes
  for each statement execute function crm_repair_private.rebuild_agent_lessons();
