-- SQL47: run the first-contact lookup in two simple steps (visible clients, then
-- per-client earliest message). The single combined query of SQL46 picked a bad
-- plan (5 s in production). Same output as SQL45/46 for owner and Barka on two
-- 400-client sets; 50–270 ms owner, 66–520 ms Barka; 4 parallel API calls ~0.5 s.
CREATE OR REPLACE FUNCTION public.crm_client_first_contacts(p_client_ids uuid[])
RETURNS TABLE(client_id uuid, first_contact_at timestamptz, first_contact_source text)
LANGUAGE plpgsql STABLE
AS $function$
DECLARE v_ids uuid[]; v_company uuid:=public.my_company();
BEGIN
 IF p_client_ids IS NULL OR cardinality(p_client_ids)>400 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_client_contact_batch'; END IF;
 -- Caller RLS decides which clients are visible.
 SELECT coalesce(array_agg(c.id),'{}'::uuid[]) INTO v_ids FROM public.clients c
  WHERE c.company_id=v_company AND public.my_role() IS NOT NULL AND c.id=ANY(p_client_ids);
 RETURN QUERY
 SELECT w.client_id,
  CASE WHEN w.at IS NULL THEN g.ig WHEN g.ig IS NULL THEN w.at WHEN g.ig<=w.at THEN g.ig ELSE w.at END,
  CASE WHEN w.at IS NULL AND g.ig IS NULL THEN NULL WHEN w.at IS NULL THEN 'instagram' WHEN g.ig IS NULL THEN 'whatsapp' WHEN g.ig<=w.at THEN 'instagram' ELSE 'whatsapp' END
 FROM crm_repair_private.client_first_whatsapp_inbound(v_ids) w
 LEFT JOIN LATERAL (SELECT i.message_timestamp AS ig FROM public.instagram_messages i
   WHERE i.client_id=w.client_id AND i.company_id=v_company AND i.direction='inbound' AND i.message_timestamp IS NOT NULL
   ORDER BY i.message_timestamp LIMIT 1) g ON true
 ORDER BY w.client_id;
END
$function$;
