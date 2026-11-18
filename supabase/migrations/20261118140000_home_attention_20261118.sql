-- SQL126 (18 Nov 2026, Ahmed's check, items 4 and 5): two lists at the top of the owner home.
--   «المشترين الواقفين»: every buyer who asked a question in the last 7 days that nobody answered (no message from us after
--      it, agent or office): the name, the question and «تم». It leaves the list by itself once someone answers, or with «تم»
--      (whatsapp_conversations.waiting_done_at); a new question after «تم» brings it back. Sellers, ignored chats (SQL98) and
--      chats outside Barka / Muscat are not in it.
--   «العقود»: agreements that end within 45 days, non-exclusive properties whose availability was not confirmed in the last
--      14 days (with «متوفر» that sets availability_checked_at), and the brokerage contracts to sign (the owner accepted the
--      study and the property is not in the CRM yet).
-- Owner only (raise owner_only otherwise). Rollback: 126-home-attention.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS waiting_done_at timestamptz;

CREATE OR REPLACE FUNCTION crm_repair_private.is_question(t text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- a link («…/reel/x?igsh=…») is not a question: links are taken out first
  select regexp_replace(coalesce(t, ''), 'https?://\S+', '', 'g') ~ '[؟?]'
      or regexp_replace(coalesce(t, ''), 'https?://\S+', '', 'g') ~ '^\s*(كم|بكم|وين|فين|متى|هل|ايش|إيش|ايش|شو|وش|كيف|ليش|ليه|ممكن|عندكم|عندك|فيه|في\s|متوفر|متاح|باقي|اي\s|أي\s|السعر|المساحة|الموقع)'
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.is_question(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_home_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_waiting jsonb; v_expiring jsonb; v_unchecked jsonb; v_contracts jsonb;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'asked_at' DESC), '[]') INTO v_waiting FROM (
    SELECT jsonb_build_object('conversation_id', w.id, 'client_id', w.client_id, 'route', w.route_key,
             'name', CASE WHEN public.crm_is_real_name(cl.name) THEN cl.name WHEN public.crm_is_real_name(w.customer_name) THEN w.customer_name
                          ELSE coalesce(cl.phone_normalized, cl.phone, w.customer_wa_id) END,
             'phone', coalesce(w.customer_wa_id, cl.phone_normalized, cl.phone),
             'question', left(q.txt, 300), 'asked_at', q.at) AS x
      FROM public.whatsapp_conversations w
      LEFT JOIN public.clients cl ON cl.id = w.client_id
      CROSS JOIN LATERAL (
        SELECT coalesce(nullif(m.transcript, ''), m.body) AS txt, m.message_timestamp AS at
          FROM public.whatsapp_messages m
         WHERE m.conversation_id = w.id AND m.direction = 'inbound'
           AND m.message_timestamp > now() - interval '7 days'
           AND m.message_timestamp > coalesce(w.waiting_done_at, '-infinity'::timestamptz)
           AND m.message_type IN ('text', 'audio', 'button', 'interactive')
           AND crm_repair_private.is_question(coalesce(nullif(m.transcript, ''), m.body))
           AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages o
                            WHERE o.conversation_id = w.id AND o.direction = 'outbound'
                              AND coalesce(o.message_type, '') NOT IN ('reaction', 'edit', 'revoke', 'system', 'unsupported')
                              AND o.message_timestamp >= m.message_timestamp)
         ORDER BY m.message_timestamp DESC
         LIMIT 1) q
     WHERE w.company_id = v_company AND w.route_key IN ('barka', 'muscat')
       AND w.last_inbound_at > now() - interval '7 days'
       AND w.ignored_at IS NULL
       -- the office's own numbers (staff, branch numbers, Ahmed's test and approver numbers) are not buyers
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.company_id = v_company AND length(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g')) >= 8
                          AND right(regexp_replace(pr.phone, '\D', '', 'g'), 8) = right(regexp_replace(coalesce(w.customer_wa_id, cl.phone, ''), '\D', '', 'g'), 8))
       AND NOT EXISTS (SELECT 1 FROM public.company_lead_routes x WHERE length(regexp_replace(coalesce(x.whatsapp_number, ''), '\D', '', 'g')) >= 8
                          AND right(regexp_replace(x.whatsapp_number, '\D', '', 'g'), 8) = right(regexp_replace(coalesce(w.customer_wa_id, ''), '\D', '', 'g'), 8))
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_automation_runtime rt
                        CROSS JOIN LATERAL unnest(coalesce(rt.allowed_customer_phones, '{}'::text[]) || coalesce(rt.approver_phone, '')) ph
                        WHERE rt.company_id = v_company AND length(regexp_replace(coalesce(ph, ''), '\D', '', 'g')) >= 8
                          AND right(regexp_replace(ph, '\D', '', 'g'), 8) = right(regexp_replace(coalesce(w.customer_wa_id, ''), '\D', '', 'g'), 8))
       AND coalesce(cl.client_type, '') <> 'seller'
       AND NOT EXISTS (SELECT 1 FROM public.owner_leads ol WHERE ol.client_id = w.client_id AND ol.status IN ('open', 'studied'))
       AND NOT coalesce(cl.archived, false)
     LIMIT 60) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.internal_name, p.title), 'branch', p.branch_key,
           'end_date', p.agreement_end_date, 'days_left', p.agreement_end_date - (now() at time zone 'Asia/Muscat')::date) ORDER BY p.agreement_end_date), '[]')
    INTO v_expiring FROM public.properties p
   WHERE p.company_id = v_company AND NOT coalesce(p.archived, false) AND p.status IN ('available', 'reserved')
     AND coalesce(p.has_listing_agreement, false)
     AND p.agreement_end_date BETWEEN (now() at time zone 'Asia/Muscat')::date AND (now() at time zone 'Asia/Muscat')::date + 45;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.internal_name, p.title), 'branch', p.branch_key, 'status', p.status,
           'checked_at', p.availability_checked_at) ORDER BY p.availability_checked_at NULLS FIRST), '[]')
    INTO v_unchecked FROM public.properties p
   WHERE p.company_id = v_company AND NOT coalesce(p.archived, false) AND p.status IN ('available', 'reserved')
     AND NOT coalesce(p.has_listing_agreement, false)
     AND (p.availability_checked_at IS NULL OR p.availability_checked_at < now() - interval '14 days');

  SELECT coalesce(jsonb_agg(jsonb_build_object('study_id', s.id, 'client_id', s.client_id, 'conversation_id', s.conversation_id,
           'name', coalesce(nullif(cl.name, ''), 'مالك'), 'phone', coalesce(cl.phone_normalized, cl.phone),
           'property', concat_ws(' · ', l.kind, coalesce(l.area, l.wilayat)), 'accepted_at', s.owner_reaction_at) ORDER BY s.owner_reaction_at DESC), '[]')
    INTO v_contracts FROM public.owner_price_studies s
    LEFT JOIN public.owner_leads l ON l.id = s.owner_lead_id
    LEFT JOIN public.clients cl ON cl.id = s.client_id
   WHERE s.company_id = v_company AND s.status = 'sent' AND s.owner_reaction = 'accepted'
     AND coalesce(l.status, 'studied') <> 'listed' AND coalesce(l.status, '') <> 'closed';

  RETURN jsonb_build_object('waiting', v_waiting, 'expiring', v_expiring, 'unchecked', v_unchecked, 'new_contracts', v_contracts);
END $function$;
REVOKE ALL ON FUNCTION public.crm_home_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_home_attention() TO authenticated;

-- «تم» on a waiting buyer: hidden until he asks again
CREATE OR REPLACE FUNCTION public.crm_waiting_buyer_done(p_conversation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  UPDATE public.whatsapp_conversations SET waiting_done_at = now() WHERE id = p_conversation AND company_id = v_company;
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.crm_waiting_buyer_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_waiting_buyer_done(uuid) TO authenticated;

-- «متوفر» on a non-exclusive property: availability confirmed now
CREATE OR REPLACE FUNCTION public.crm_property_confirm_available(p_property uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  UPDATE public.properties SET availability_checked_at = now() WHERE id = p_property AND company_id = v_company;
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.crm_property_confirm_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_property_confirm_available(uuid) TO authenticated;
