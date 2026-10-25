-- SQL45: faster client first-contact lookup (clients page).
-- The earliest inbound message was ordered by (message_timestamp, id), which the
-- (client_id, message_timestamp) index cannot serve, so every message of each
-- client was read and passed through the per-row message policies before sorting.
-- Only the timestamp is returned, so ordering by the timestamp alone returns the
-- same value and lets the index stop at the first visible row. Caller RLS is
-- unchanged (SECURITY INVOKER). Trial: identical output for owner and Barka on
-- 400 clients; 674→126 ms (owner), 386→149 ms (Barka).
CREATE OR REPLACE FUNCTION public.crm_client_first_contacts(p_client_ids uuid[])
RETURNS TABLE(client_id uuid, first_contact_at timestamptz, first_contact_source text)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
 IF p_client_ids IS NULL OR cardinality(p_client_ids)>400 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_client_contact_batch'; END IF;
 RETURN QUERY
 SELECT c.id,entry.at,entry.source
 FROM public.clients c
 LEFT JOIN LATERAL (
  SELECT candidate.at,candidate.source FROM (
   (SELECT w.message_timestamp AS at,'whatsapp'::text AS source FROM public.whatsapp_messages w
     WHERE w.client_id=c.id AND w.company_id=c.company_id AND w.direction='inbound' AND w.message_timestamp IS NOT NULL
     ORDER BY w.message_timestamp LIMIT 1)
   UNION ALL
   (SELECT i.message_timestamp AS at,'instagram'::text AS source FROM public.instagram_messages i
     WHERE i.client_id=c.id AND i.company_id=c.company_id AND i.direction='inbound' AND i.message_timestamp IS NOT NULL
     ORDER BY i.message_timestamp LIMIT 1)
  ) candidate ORDER BY candidate.at,candidate.source LIMIT 1
 ) entry ON true
 WHERE c.company_id=public.my_company() AND public.my_role() IS NOT NULL AND c.id=ANY(p_client_ids)
 ORDER BY c.id;
END
$function$;
