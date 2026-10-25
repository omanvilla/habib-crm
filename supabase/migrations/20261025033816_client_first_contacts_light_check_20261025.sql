-- SQL46: first-contact lookup without per-row JSON of whole WhatsApp messages.
-- The whatsapp_messages policy calls investment_row_allowed(company, to_jsonb(row)),
-- which serialises raw_payload for every scanned message. A definer helper applies
-- the same two rules (can_access_whatsapp_conversation + investment link check) on
-- only the id columns that check reads; the owner needs neither. Clients are still
-- filtered by caller RLS in the invoker wrapper, and Instagram stays caller-RLS.
-- Trial: identical output to SQL45 for owner and Barka on two 400-client sets.
CREATE OR REPLACE FUNCTION crm_repair_private.client_first_whatsapp_inbound(p_client_ids uuid[])
RETURNS TABLE(client_id uuid, at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid:=public.my_company(); v_owner boolean;
BEGIN
 IF v_company IS NULL OR p_client_ids IS NULL OR cardinality(p_client_ids)>400 THEN RETURN; END IF;
 SELECT p.role='owner' INTO v_owner FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.company_id=v_company AND p.is_active IS TRUE;
 IF v_owner IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT x.id,(SELECT m.message_timestamp FROM public.whatsapp_messages m
   WHERE m.client_id=x.id AND m.company_id=v_company AND m.direction='inbound' AND m.message_timestamp IS NOT NULL
    AND (v_owner OR (crm_repair_private.can_access_whatsapp_conversation(v_company,m.conversation_id)
     AND NOT crm_repair_private.investment_link_is_private(v_company,jsonb_build_object('client_id',m.client_id,'conversation_id',m.conversation_id,'request_id',m.request_id,'matched_property_id',m.matched_property_id,'matched_marketing_event_id',m.matched_marketing_event_id))))
   ORDER BY m.message_timestamp LIMIT 1)
  FROM unnest(p_client_ids) x(id);
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.client_first_whatsapp_inbound(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.client_first_whatsapp_inbound(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_client_first_contacts(p_client_ids uuid[])
RETURNS TABLE(client_id uuid, first_contact_at timestamptz, first_contact_source text)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
 IF p_client_ids IS NULL OR cardinality(p_client_ids)>400 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_client_contact_batch'; END IF;
 RETURN QUERY
 WITH v AS (SELECT c.id,c.company_id FROM public.clients c WHERE c.company_id=public.my_company() AND public.my_role() IS NOT NULL AND c.id=ANY(p_client_ids)),
 wa AS (SELECT f.client_id,f.at FROM crm_repair_private.client_first_whatsapp_inbound((SELECT coalesce(array_agg(v.id),'{}'::uuid[]) FROM v)) f),
 s AS (SELECT v.id,wa.at AS wa,(SELECT i.message_timestamp FROM public.instagram_messages i WHERE i.client_id=v.id AND i.company_id=v.company_id AND i.direction='inbound' AND i.message_timestamp IS NOT NULL ORDER BY i.message_timestamp LIMIT 1) AS ig
  FROM v LEFT JOIN wa ON wa.client_id=v.id)
 SELECT s.id,
  CASE WHEN s.wa IS NULL THEN s.ig WHEN s.ig IS NULL THEN s.wa WHEN s.ig<=s.wa THEN s.ig ELSE s.wa END,
  CASE WHEN s.wa IS NULL AND s.ig IS NULL THEN NULL WHEN s.wa IS NULL THEN 'instagram' WHEN s.ig IS NULL THEN 'whatsapp' WHEN s.ig<=s.wa THEN 'instagram' ELSE 'whatsapp' END
 FROM s ORDER BY s.id;
END
$function$;
