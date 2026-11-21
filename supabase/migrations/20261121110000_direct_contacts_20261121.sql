-- SQL151 (21 Nov 2026, Ahmed): «تواصل مباشر», people the agent never answers and who are not «العقل موقوف عندهم».
-- «في اشخاص العقل لازم خلاص يوقف معاهم وما يرد عليهم ابدا: الملاك اللي نحن نتواصل معاهم، والمسوقين مال المطورين اللي نتعامل
-- معاهم (مثل امير وروان)... ما يدخلوا من ضمن كمّل يا عقل ابدا، اريدهم في خانة ثانية اشوف كم شخص».
--   * whatsapp_conversations.direct_contact_at / _kind / _by: owner (a property owner we work with), developer (a developer's
--     marketer), office_call (an owner the office called; he stays here until his study is settled).
--   * On: agent_muted with the reason «تواصل مباشر: …» (the agent and every automatic follow-up already skip a muted chat),
--     and any handoff is cleared, so the chat leaves «العقل موقوف عندهم», «مشترين واقفين» and «متابعة اليوم».
--   * Off («رجّعه للعقل»): the agent answers again. Anything that unmutes the chat (e.g. «كمّل يا عقل» from the chat screen)
--     also takes it out of the list, so the two never disagree.
--   * A chat whose handoff says «اتصال المكتب» goes here by itself (office_call); the 6 open ones are moved now.
--   * crm_paused_chats returns the list under «direct» for the home tile «تواصل مباشر»; crm_set_direct_contact sets it.
-- Rollback: 151-direct-contacts.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS direct_contact_at timestamptz;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS direct_contact_kind text;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS direct_contact_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_direct_contact_kind_check;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_direct_contact_kind_check
  CHECK (direct_contact_kind IS NULL OR direct_contact_kind IN ('owner', 'developer', 'office_call'));

CREATE OR REPLACE FUNCTION crm_repair_private.direct_contact_label(p_kind text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  select case p_kind when 'owner' then 'مالك نشتغل معاه' when 'developer' then 'مسوق مطور' when 'office_call' then 'مالك من اتصال المكتب' else 'تواصل مباشر' end
$function$;

-- keeps the flags in step: «اتصال المكتب» puts a chat here; unmuting it takes it out
CREATE OR REPLACE FUNCTION crm_repair_private.direct_contact_sync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  if new.direct_contact_at is not null and coalesce(new.agent_muted, false) = false
     and (tg_op = 'UPDATE' and coalesce(old.agent_muted, false) = true) then
    new.direct_contact_at := null; new.direct_contact_kind := null; new.direct_contact_by := null;
  end if;
  if new.direct_contact_at is null and new.ignored_at is null and coalesce(new.handoff_reason, '') ilike 'اتصال المكتب%'
     and (tg_op = 'INSERT' or coalesce(old.handoff_reason, '') is distinct from coalesce(new.handoff_reason, '')) then
    new.direct_contact_at := now(); new.direct_contact_kind := 'office_call';
  end if;
  if new.direct_contact_at is not null and (tg_op = 'INSERT' or old.direct_contact_at is null) then
    new.agent_muted := true;
    new.agent_muted_reason := 'تواصل مباشر: ' || crm_repair_private.direct_contact_label(new.direct_contact_kind);
    new.human_handoff_required := false;
  end if;
  return new;
end $function$;
REVOKE ALL ON FUNCTION crm_repair_private.direct_contact_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_direct_contact_sync ON public.whatsapp_conversations;
CREATE TRIGGER crm_direct_contact_sync BEFORE INSERT OR UPDATE OF agent_muted, handoff_reason, direct_contact_at ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.direct_contact_sync();

CREATE OR REPLACE FUNCTION public.crm_set_direct_contact(p_conversation uuid, p_on boolean, p_kind text DEFAULT 'owner')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner'; n int;
begin
  if public.my_role() is null or public.my_role() not in ('owner','manager','agent') then raise exception 'owner_only' using errcode='42501'; end if;
  if p_on and coalesce(p_kind, '') not in ('owner', 'developer', 'office_call') then raise exception 'bad_kind'; end if;
  if p_on then
    update public.whatsapp_conversations c set direct_contact_at = now(), direct_contact_kind = p_kind, direct_contact_by = (select auth.uid()),
           agent_muted = true, agent_muted_reason = 'تواصل مباشر: ' || crm_repair_private.direct_contact_label(p_kind),
           human_handoff_required = false, handoff_updated_at = now(), updated_at = now()
     where c.id = p_conversation and c.company_id = v_company and (v_owner or crm_repair_private.can_access_whatsapp_conversation(v_company, c.id));
  else
    update public.whatsapp_conversations c set direct_contact_at = null, direct_contact_kind = null, direct_contact_by = null,
           agent_muted = false, agent_muted_reason = null, agent_returned_at = now(), updated_at = now()
     where c.id = p_conversation and c.company_id = v_company and c.direct_contact_at is not null
       and (v_owner or crm_repair_private.can_access_whatsapp_conversation(v_company, c.id));
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found' using errcode='P0002'; end if;
  return jsonb_build_object('ok', true, 'direct', p_on);
end $function$;
REVOKE ALL ON FUNCTION public.crm_set_direct_contact(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_direct_contact(uuid, boolean, text) TO authenticated;

-- the home: paused chats without the direct ones, and the direct list beside them
CREATE OR REPLACE FUNCTION public.crm_paused_chats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner'; res jsonb; dir jsonb;
begin
  if public.my_role() is null or public.my_role() not in ('owner','manager','agent') then raise exception 'owner_only' using errcode='42501'; end if;
  with base as (
    select c.id, c.client_id, c.customer_phone, c.route_key, c.last_inbound_at, c.last_outbound_at, c.ai_summary,
           coalesce(nullif(cl.name,''), c.customer_name, c.customer_phone) as name,
           c.agent_muted, c.agent_muted_reason, c.human_handoff_required, c.handoff_reason
      from public.whatsapp_conversations c
      left join public.clients cl on cl.id = c.client_id
     where c.company_id = v_company
       and c.last_inbound_at > now() - interval '30 days'
       and c.ignored_at is null
       and c.direct_contact_at is null
       and (v_owner or c.route_key is distinct from 'owner')
  ), flagged as (
    select b.*,
      case when b.agent_muted then 'muted'
           when b.human_handoff_required and coalesce(b.handoff_reason,'') ~ '^\s*سؤال ما عندي جوابه\s*:' then 'unknown_q'
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
                       when 'manual_reply' then case when v_owner then 'رديت بنفسك والعقل ساكن لين ترجّعها' else 'انرد عليها من المكتب والعقل ساكن لين ترجّعها' end
                       else coalesce(f.handoff_reason,'يحتاج مراجعتك') end as reason,
           left(coalesce(f.ai_summary,''), 220) as summary,
           (select left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 160)
              from public.whatsapp_messages m where m.conversation_id = f.id and m.direction='inbound'
             order by m.message_timestamp desc limit 1) as last_message
      from flagged f where f.kind is not null
      order by f.last_inbound_at desc limit 80) x;
  select coalesce(jsonb_agg(d order by d.waiting desc, d.last_inbound_at desc nulls last), '[]'::jsonb) into dir from (
    select c.id as conversation_id, c.client_id, coalesce(nullif(cl.name,''), c.customer_name, c.customer_phone) as name,
           c.customer_phone as phone, c.route_key, c.direct_contact_kind as kind,
           crm_repair_private.direct_contact_label(c.direct_contact_kind) as reason, c.direct_contact_at, c.last_inbound_at,
           (c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity')) as waiting,
           (select left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 160)
              from public.whatsapp_messages m where m.conversation_id = c.id and m.direction='inbound'
             order by m.message_timestamp desc limit 1) as last_message
      from public.whatsapp_conversations c left join public.clients cl on cl.id = c.client_id
     where c.company_id = v_company and c.direct_contact_at is not null and c.ignored_at is null
       and (v_owner or (c.route_key is distinct from 'owner' and crm_repair_private.can_access_whatsapp_conversation(v_company, c.id)))
     order by c.last_inbound_at desc nulls last limit 200) d;
  return jsonb_build_object('items', res, 'total', jsonb_array_length(res), 'direct', dir,
    'ignored', (select count(*) from public.whatsapp_conversations c where c.company_id = v_company and c.ignored_at is not null
                  and (v_owner or c.route_key is distinct from 'owner')));
end $function$;

-- «مشترين واقفين» and «متابعة اليوم» leave the direct chats out
DO $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.crm_home_attention'::regproc);
  n := replace(d, 'AND w.ignored_at IS NULL', 'AND w.ignored_at IS NULL AND w.direct_contact_at IS NULL');
  if n = d then raise exception 'crm_home_attention: anchor not found'; end if;
  execute n;
  d := pg_get_functiondef('public.crm_followups_today'::regproc);
  n := replace(d, 'WHERE v_owner OR (public.my_role() IN (''manager'',''agent'',''viewer'') AND i.route_key IS DISTINCT FROM ''owner'')',
    'WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations dw WHERE dw.id = i.conversation_id AND dw.direct_contact_at IS NOT NULL) AND (v_owner OR (public.my_role() IN (''manager'',''agent'',''viewer'') AND i.route_key IS DISTINCT FROM ''owner''))');
  if n = d then raise exception 'crm_followups_today: anchor not found'; end if;
  execute n;
end $do$;

-- the office-call owners already waiting move now
UPDATE public.whatsapp_conversations c SET direct_contact_at = now(), direct_contact_kind = 'office_call'
 WHERE c.direct_contact_at IS NULL AND c.ignored_at IS NULL
   AND (coalesce(c.handoff_reason, '') ilike 'اتصال المكتب%' OR (coalesce(c.handoff_reason, '') ilike '%] اتصال المكتب%' AND c.human_handoff_required));
