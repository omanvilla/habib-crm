-- SQL98 (12 Nov 2026, Ahmed): R40 the ignored chats, R41 a question the agent has no answer for, R42 a fixed price.
--   1. whatsapp_conversations.ignored_at / ignore_kind: a chat the office never answers (job seeker, someone who wants to sign up
--      as a broker under the office, a broker from outside Oman, bank staff, someone offering a service, or Ahmed's own «تجاهل»).
--      It stays muted (agent_muted, so every reply / follow-up / notice refuses it through crm_chat_hold) and it leaves
--      «العقل موقوف عندهم»: crm_paused_chats skips it, crm_ignored_chats lists it, crm_set_chat_ignored ignores or gives it back.
--   2. «سؤال ما عندي جوابه:» is a hard handoff like تفاوض / مشتري جاد / دراسة سعر (the agent stays quiet in that chat until it is
--      given back) and shows in the paused list as its own kind «unknown_q».
--   3. properties.price_negotiable: 'fixed' / 'negotiable' / NULL (not set). The agent answers a fixed price after a visit; the rest
--      goes to Ahmed as «مشتري جاد» (R16). Appended at the end of crm_properties_access.
--   4. Data: the chats already in the paused list that are one of these move to the ignored list.
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS ignored_at timestamptz;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS ignore_kind text;
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_ignore_kind_chk;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_ignore_kind_chk
  CHECK (ignore_kind IS NULL OR ignore_kind IN ('job','broker_signup','foreign_broker','bank','service','other'));
CREATE INDEX IF NOT EXISTS whatsapp_conversations_ignored_idx ON public.whatsapp_conversations (company_id, ignored_at DESC) WHERE ignored_at IS NOT NULL;

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS price_negotiable text;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_price_negotiable_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_price_negotiable_chk CHECK (price_negotiable IS NULL OR price_negotiable IN ('fixed','negotiable'));
GRANT SELECT, INSERT, UPDATE (price_negotiable) ON public.properties TO authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.is_hard_handoff(p_reason text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  select coalesce(p_reason, '') ~ '^\s*(تفاوض|مشتري جاد|دراسة سعر|سؤال ما عندي جوابه)\s*:'
$f$;

CREATE OR REPLACE FUNCTION public.crm_paused_chats()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner'; res jsonb;
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
  return jsonb_build_object('items', res, 'total', jsonb_array_length(res),
    'ignored', (select count(*) from public.whatsapp_conversations c where c.company_id = v_company and c.ignored_at is not null
                  and (v_owner or c.route_key is distinct from 'owner')));
end $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.ignore_label(p_kind text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  select case p_kind when 'job' then 'طالب وظيفة' when 'broker_signup' then 'يبي يتسجل وسيط عندنا'
    when 'foreign_broker' then 'وسيط أو شركة من برا عمان' when 'bank' then 'موظف بنك يعرض تعاون'
    when 'service' then 'يعرض خدمة' else 'تجاهلته أنت' end
$f$;

-- the ignored list (owner and staff, like the paused list; the owner's private line stays the owner's)
CREATE OR REPLACE FUNCTION public.crm_ignored_chats()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner'; res jsonb;
begin
  if public.my_role() is null or public.my_role() not in ('owner','manager','agent') then raise exception 'owner_only' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x.ignored_at desc), '[]'::jsonb) into res from (
    select c.id as conversation_id, c.client_id, coalesce(nullif(cl.name,''), c.customer_name, c.customer_phone) as name,
           c.customer_phone as phone, c.route_key, c.ignore_kind, crm_repair_private.ignore_label(c.ignore_kind) as reason,
           c.ignored_at, c.last_inbound_at,
           (select left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 160)
              from public.whatsapp_messages m where m.conversation_id = c.id and m.direction='inbound'
             order by m.message_timestamp desc limit 1) as last_message
      from public.whatsapp_conversations c left join public.clients cl on cl.id = c.client_id
     where c.company_id = v_company and c.ignored_at is not null and (v_owner or c.route_key is distinct from 'owner')
     order by c.ignored_at desc limit 200) x;
  return jsonb_build_object('items', res, 'total', jsonb_array_length(res));
end $function$;

-- Ahmed (or staff) ignores a chat from the paused list, or gives an ignored one back (the agent answers it again)
CREATE OR REPLACE FUNCTION public.crm_set_chat_ignored(p_conversation uuid, p_ignored boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner'; n int;
begin
  if public.my_role() is null or public.my_role() not in ('owner','manager','agent') then raise exception 'owner_only' using errcode='42501'; end if;
  if p_ignored then
    update public.whatsapp_conversations c set ignored_at = now(), ignore_kind = coalesce(c.ignore_kind, 'other'), agent_muted = true,
           agent_muted_reason = 'متجاهل: ' || crm_repair_private.ignore_label(coalesce(c.ignore_kind, 'other')),
           human_handoff_required = false, handoff_reason = null, handoff_updated_at = now(), updated_at = now()
     where c.id = p_conversation and c.company_id = v_company and (v_owner or c.route_key is distinct from 'owner');
  else
    update public.whatsapp_conversations c set ignored_at = null, ignore_kind = null, agent_muted = false, agent_muted_reason = null,
           agent_returned_at = now(), updated_at = now()
     where c.id = p_conversation and c.company_id = v_company and c.ignored_at is not null and (v_owner or c.route_key is distinct from 'owner');
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found' using errcode='P0002'; end if;
  return jsonb_build_object('ok', true, 'ignored', p_ignored);
end $function$;

REVOKE ALL ON FUNCTION crm_repair_private.ignore_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_ignored_chats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_set_chat_ignored(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ignored_chats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_set_chat_ignored(uuid, boolean) TO authenticated, service_role;

-- 3. the view: price_negotiable appended at the end. Refused when the live view is not the SQL97 body.
DO $guard$
DECLARE v_def text; v_path text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.crm_properties_access'::regclass, true);
  PERFORM set_config('search_path', v_path, true);
  IF md5(v_def) <> '2dfb1cf0f029a7653c9aec4084f18fbd' AND position('price_negotiable' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL98 refused: public.crm_properties_access changed since SQL97 (md5 %)', md5(v_def);
  END IF;
END
$guard$;
CREATE OR REPLACE VIEW public.crm_properties_access AS
 SELECT t.id,
    t.company_id,
    t.added_by,
    t.title,
    t.type,
    t.area,
    t.price,
    t.bedrooms,
    t.bathrooms,
    t.land_size,
    t.built_size,
    t.status,
    t.description,
    t.images,
    t.views_count,
    t.inquiries_count,
    t.created_at,
    t.updated_at,
    t.owner_client_id,
    t.archived,
    t.archived_at,
    t.archived_by,
    t.owner_id,
        CASE
            WHEN public.my_role() = 'owner'::text THEN t.owner_net
            ELSE NULL::numeric
        END AS owner_net,
    t.wilayat,
    t.source_type,
    t.marketing_status,
        CASE
            WHEN public.my_role() = 'owner'::text THEN t.expected_commission
            ELSE NULL::numeric
        END AS expected_commission,
    t.property_code,
    t.internal_name,
    t.branch_key,
    t.availability_checked_at,
    t.performance_tracking_started_at,
    t.photography_status,
    t.photography_reason,
    t.photography_required_at,
    t.photography_completed_at,
    t.marketing_review_status,
    t.marketing_reviewed_at,
    t.marketing_review_note,
    t.last_ai_recommendation,
    t.last_ai_recommendation_at,
    t.public_details,
    t.map_url,
    t.has_listing_agreement,
    t.agreement_start_date,
    t.agreement_duration_months,
    t.agreement_end_date,
    t.agreement_reminder_days,
    t.sourced_by,
    t.listing_purpose,
    t.archive_reason,
    t.archive_note,
    t.archive_source,
    t.archive_evidence,
    t.relisted_at,
    t.unit_label,
    t.price_negotiable
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);

-- 4. data: the chats already muted or handed over that are one of these (read 12 Nov evening)
UPDATE public.whatsapp_conversations c SET ignored_at = now(), ignore_kind = v.k, agent_muted = true,
       agent_muted_reason = 'متجاهل: ' || crm_repair_private.ignore_label(v.k),
       human_handoff_required = false, handoff_reason = null, handoff_updated_at = now(), updated_at = now()
  FROM (VALUES ('e6d4ca02-326c-4274-bebe-5db56942110f'::uuid, 'broker_signup'),
               ('3b07aa0d-6edc-42cf-891e-26facaf7691b'::uuid, 'job'),
               ('d6962557-8271-4841-86ab-3303f03e81df'::uuid, 'service'),
               ('eba5909b-d52c-4ed7-8146-3fd5ff6df211'::uuid, 'other')) v(id, k)
 WHERE c.id = v.id AND c.ignored_at IS NULL;
-- the fixed price Ahmed named (فيلا الرميس 59، 12 Nov) is set from the CRM after this, not here
