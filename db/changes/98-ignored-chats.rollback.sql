-- Rollback of SQL98. Pin whatsapp-reply-agent back to its previous commit FIRST (it writes ignored_at / ignore_kind and reads
-- price_negotiable). The ignored chats stay muted (agent_muted, «متجاهل: …») and come back in the paused list as «مكتوم عنهم».
-- The columns stay (Ahmed's data); drop them by hand only when nothing uses them.
SET LOCAL lock_timeout = '10s';
DROP FUNCTION IF EXISTS public.crm_set_chat_ignored(uuid, boolean);
DROP FUNCTION IF EXISTS public.crm_ignored_chats();
CREATE OR REPLACE FUNCTION crm_repair_private.is_hard_handoff(p_reason text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  select coalesce(p_reason, '') ~ '^\s*(تفاوض|مشتري جاد|دراسة سعر)\s*:'
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
       and (v_owner or c.route_key is distinct from 'owner')
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
                       when 'manual_reply' then case when v_owner then 'رديت بنفسك والعقل ساكن لين ترجّعها' else 'انرد عليها من المكتب والعقل ساكن لين ترجّعها' end
                       else coalesce(f.handoff_reason,'يحتاج مراجعتك') end as reason,
           left(coalesce(f.ai_summary,''), 220) as summary,
           (select left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 160)
              from public.whatsapp_messages m where m.conversation_id = f.id and m.direction='inbound'
             order by m.message_timestamp desc limit 1) as last_message
      from flagged f where f.kind is not null
      order by f.last_inbound_at desc limit 80) x;
  return jsonb_build_object('items', res, 'total', jsonb_array_length(res));
end $function$;
DROP FUNCTION IF EXISTS crm_repair_private.ignore_label(text);
DROP VIEW IF EXISTS public.crm_properties_access;
CREATE VIEW public.crm_properties_access AS
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
    t.unit_label
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;
