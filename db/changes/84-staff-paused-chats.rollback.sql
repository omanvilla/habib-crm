-- Rollback of SQL84: paused chats owner-only again (body as live before 11 Nov 2026, md5 5c42db17...).
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION public.crm_paused_chats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); res jsonb;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode='42501'; end if;
  with base as (
    select c.id, c.client_id, c.customer_phone, c.route_key, c.last_inbound_at, c.last_outbound_at, c.ai_summary,
           coalesce(nullif(cl.name,''), c.customer_name, c.customer_phone) as name,
           c.agent_muted, c.agent_muted_reason, c.human_handoff_required, c.handoff_reason
      from public.whatsapp_conversations c
      left join public.clients cl on cl.id = c.client_id
     where c.company_id = v_company
       and c.last_inbound_at > now() - interval '30 days'
  ), flagged as (
    select b.*,
      case when b.agent_muted then 'muted'
           when b.human_handoff_required and crm_repair_private.is_hard_handoff(b.handoff_reason) then 'negotiation'
           when b.human_handoff_required then 'handoff'
           when b.last_inbound_at > coalesce(b.last_outbound_at,'-infinity') then
             case when public.crm_chat_hold(b.id) = 'manual_reply' then 'manual_reply' end
      end as kind
      from base b
  )
  select coalesce(jsonb_agg(x order by x.last_inbound_at desc), '[]'::jsonb) into res from (
    select f.id as conversation_id, f.client_id, f.name, f.customer_phone as phone, f.route_key, f.kind, f.last_inbound_at,
           case f.kind when 'muted' then coalesce(f.agent_muted_reason,'مكتوم')
                       when 'manual_reply' then 'رديت بنفسك والعقل ساكن لين ترجّعها'
                       else coalesce(f.handoff_reason,'يحتاج مراجعتك') end as reason,
           left(coalesce(f.ai_summary,''), 220) as summary,
           (select left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 160)
              from public.whatsapp_messages m where m.conversation_id = f.id and m.direction='inbound'
             order by m.message_timestamp desc limit 1) as last_message
      from flagged f where f.kind is not null
      order by f.last_inbound_at desc limit 80) x;
  return jsonb_build_object('items', res, 'total', jsonb_array_length(res));
end $function$;
