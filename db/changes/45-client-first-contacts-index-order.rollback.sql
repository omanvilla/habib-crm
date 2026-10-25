-- Rollback for SQL45: restore the (timestamp, id) ordering.
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
     ORDER BY w.message_timestamp,w.id LIMIT 1)
   UNION ALL
   (SELECT i.message_timestamp AS at,'instagram'::text AS source FROM public.instagram_messages i
     WHERE i.client_id=c.id AND i.company_id=c.company_id AND i.direction='inbound' AND i.message_timestamp IS NOT NULL
     ORDER BY i.message_timestamp,i.id LIMIT 1)
  ) candidate ORDER BY candidate.at,candidate.source LIMIT 1
 ) entry ON true
 WHERE c.company_id=public.my_company() AND public.my_role() IS NOT NULL AND c.id=ANY(p_client_ids)
 ORDER BY c.id;
END
$function$;
