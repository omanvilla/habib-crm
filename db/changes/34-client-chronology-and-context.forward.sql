-- SQL34: read-only first-contact projection; verified WhatsApp context and location interest.
-- No guessed timestamps, visits, customer messages, financial edits or historical replay.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.client34_catalog_backup(signature text PRIMARY KEY,definition text NOT NULL);
ALTER TABLE crm_repair_private.client34_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.client34_catalog_backup FROM PUBLIC,anon,authenticated;
INSERT INTO crm_repair_private.client34_catalog_backup SELECT 'public.crm_property_inquiry_candidates(uuid,integer,integer)',pg_get_functiondef('public.crm_property_inquiry_candidates(uuid,integer,integer)'::regprocedure) ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.crm_property_inquiry_candidates(uuid,integer,integer)'::regprocedure))<>'a0f3151a591c6e3a55d9c2b774f928eb' THEN RAISE EXCEPTION 'candidate_definition_changed_review_required'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_client_first_contacts(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,first_contact_at timestamptz,first_contact_source text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.crm_client_first_contacts(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_client_first_contacts(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_property_inquiry_candidates(p_message_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $function$
DECLARE m public.whatsapp_messages%rowtype; w public.whatsapp_conversations%rowtype;
 private_work boolean; result jsonb;
BEGIN
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_candidate_page';END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='inbound_message_required';END IF;
 SELECT w0.* INTO w FROM public.whatsapp_conversations w0 JOIN public.clients c ON c.id=w0.client_id AND c.company_id=w0.company_id
  WHERE w0.id=m.conversation_id AND w0.company_id=m.company_id AND w0.client_id=m.client_id
   AND (c.lead_route IS DISTINCT FROM 'investment' OR w0.route_key='investment');
 IF NOT FOUND OR w.route_key NOT IN ('muscat','barka','investment') THEN
  RETURN jsonb_build_object('candidates','[]'::jsonb,'has_more',false);END IF;
 private_work:=w.route_key='investment';
 IF private_work AND NOT EXISTS(SELECT 1 FROM public.company_lead_routes r JOIN public.profiles o ON o.id=r.assigned_to AND o.company_id=r.company_id
  WHERE r.company_id=m.company_id AND r.route_key='investment' AND r.is_active AND r.owner_only_inbox AND o.role='owner' AND o.is_active
   AND w.assigned_to=o.id) THEN RETURN jsonb_build_object('candidates','[]'::jsonb,'has_more',false);END IF;
 WITH candidates AS MATERIALIZED (
  SELECT p.* FROM public.properties p WHERE p.company_id=m.company_id AND p.branch_key=w.route_key AND p.archived=false
   AND (private_work OR NOT crm_repair_private.semantic_property_is_private(m.company_id,p.id))
  ORDER BY p.id OFFSET p_offset LIMIT p_limit+1
 ), page AS (SELECT p.* FROM candidates p ORDER BY p.id LIMIT p_limit)
 SELECT jsonb_build_object('candidates',coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'title',p.title,'area',p.area,'wilayat',p.wilayat,'price',p.price,'type',p.type,
  'bathrooms',p.bathrooms,'map_url',p.map_url,'public_details',p.public_details,'status',p.status,'bedrooms',p.bedrooms,'land_size',p.land_size,'built_size',p.built_size,'property_code',p.property_code,
  'images',coalesce(to_jsonb(p.images),'[]'::jsonb),'marketing_urls',coalesce((SELECT jsonb_agg(e.url ORDER BY e.id)
   FROM public.property_marketing_events e WHERE e.company_id=m.company_id AND e.property_id=p.id AND e.url IS NOT NULL),'[]'::jsonb)) ORDER BY p.id),'[]'::jsonb),
  'has_more',(SELECT count(*) FROM candidates)>p_limit) INTO result FROM page p;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.crm_property_inquiry_candidates(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_property_inquiry_candidates(uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_record_location_interest(p_message_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE m public.whatsapp_messages%rowtype; x record; n integer:=0;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND OR m.message_timestamp IS NULL OR coalesce(m.body,'') !~* '(لوكيشن|لوكيشين|الموقع|موقعها|موقعه|location|directions)' THEN RETURN 0; END IF;
 PERFORM 1 FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 PERFORM 1 FROM public.whatsapp_messages WHERE id=m.id FOR UPDATE;
 FOR x IN
  SELECT DISTINCT r.id AS request_id,r.pipeline_stage,a.property_id
  FROM public.property_message_attributions a
  JOIN public.property_inquiries i ON i.id=a.inquiry_id AND i.company_id=a.company_id AND i.client_id=a.client_id AND i.property_id=a.property_id
  JOIN public.client_requests r ON r.id=coalesce(a.request_id,i.request_id) AND r.company_id=a.company_id AND r.client_id=a.client_id AND r.subject_property_id=a.property_id
  JOIN public.whatsapp_conversations w ON w.id=m.conversation_id AND w.company_id=m.company_id AND w.client_id=m.client_id
  WHERE a.message_id=m.id AND a.company_id=m.company_id AND a.client_id=m.client_id
    AND coalesce(r.route_key,r.branch_key)=w.route_key
 LOOP
  IF NOT EXISTS(SELECT 1 FROM public.client_request_events e WHERE e.company_id=m.company_id AND e.request_id=x.request_id AND e.whatsapp_message_id=m.id AND e.event_type='location_requested') THEN
   INSERT INTO public.client_request_events(company_id,request_id,client_id,event_type,stage,source,whatsapp_message_id,notes,after_data,occurred_at,recorded_at)
   VALUES(m.company_id,x.request_id,m.client_id,'location_requested',x.pipeline_stage,'whatsapp',m.id,
    'طلب موقع العقار؛ اهتمام بالزيارة دون موعد مؤكد.',jsonb_build_object('property_id',x.property_id,'visit_interest',true,'appointment_created',false),m.message_timestamp,now());
   n:=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.crm_record_location_interest(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_location_interest(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_apply_property_context_followup(p_message_id uuid,p_source_message_id uuid,p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE m public.whatsapp_messages%rowtype; s public.whatsapp_messages%rowtype; previous_id uuid; proven uuid[]; result jsonb;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='inbound_message_required'; END IF;
 PERFORM 1 FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound' FOR UPDATE;
 SELECT * INTO s FROM public.whatsapp_messages WHERE id=p_source_message_id AND company_id=m.company_id AND conversation_id=m.conversation_id AND client_id=m.client_id;
 IF NOT FOUND OR m.message_timestamp IS NULL OR s.message_timestamp IS NULL
   OR m.message_timestamp<s.message_timestamp OR m.message_timestamp-s.message_timestamp>interval '24 hours'
   OR length(coalesce(m.body,''))>220 OR coalesce(m.body,'') !~* '(لوكيشن|لوكيشين|الموقع|موقعها|موقعه|تفاصيل|معلومات|location|directions|details)'
   OR coalesce(m.body,'') ~* '(ثاني|أخر|اخر|غيرها|غيره|بديل|ابحث|أبحث|أدور|ادور|لا أريد|لا اريد|ما أريد|ما اريد|another|other|stop|not interested|بحث)' THEN
  RETURN jsonb_build_object('matched_count',0,'property_ids','[]'::jsonb,'review_required',true,'blocked_reason','followup_context_invalid');
 END IF;
 SELECT q.id INTO previous_id FROM public.whatsapp_messages q
  WHERE q.company_id=m.company_id AND q.conversation_id=m.conversation_id AND q.client_id=m.client_id
   AND (q.message_timestamp,q.created_at,q.id)<(m.message_timestamp,m.created_at,m.id)
  ORDER BY q.message_timestamp DESC,q.created_at DESC,q.id DESC LIMIT 1;
 IF previous_id IS DISTINCT FROM s.id THEN
  RETURN jsonb_build_object('matched_count',0,'property_ids','[]'::jsonb,'review_required',true,'blocked_reason','followup_not_adjacent'); END IF;
 IF s.direction='inbound' THEN
  SELECT array_agg(DISTINCT a.property_id) INTO proven FROM public.property_message_attributions a
   WHERE a.company_id=m.company_id AND a.client_id=m.client_id AND a.message_id=s.id;
 ELSIF s.direction='outbound' AND s.actor_type='human' AND coalesce(s.delivery_status,'') NOT IN('failed','undelivered','rejected') THEN
  SELECT array_agg(DISTINCT a.property_id) INTO proven FROM public.property_message_attributions a
   JOIN public.whatsapp_messages original ON original.id=a.message_id AND original.company_id=a.company_id AND original.client_id=a.client_id
   WHERE a.company_id=m.company_id AND a.client_id=m.client_id AND original.conversation_id=m.conversation_id
    AND original.direction='inbound' AND original.message_timestamp<=s.message_timestamp
    AND s.message_timestamp-original.message_timestamp<=interval '24 hours'
    AND a.method='ai_verified' AND a.evidence->'source_message_ids' ? s.id::text;
 END IF;
 IF cardinality(proven) IS DISTINCT FROM 1 OR proven[1] IS DISTINCT FROM p_property_id THEN
  RETURN jsonb_build_object('matched_count',0,'property_ids','[]'::jsonb,'review_required',true,'blocked_reason','followup_source_not_verified'); END IF;
 -- The original attribution transaction still enforces current parent/branch/private rules.
 result:=public.crm_apply_verified_property_inquiries(m.id,jsonb_build_array(jsonb_build_object(
  'property_id',p_property_id,'method','ai_verified','evidence',jsonb_build_object('kind','text','source_message_ids',jsonb_build_array(m.id),
  'quote',m.body,'matched_facts',jsonb_build_object('kind','verified_context_followup','support_message_id',s.id,'property_id',p_property_id)))),false);
 IF jsonb_array_length(coalesce(result->'property_ids','[]'::jsonb))>0 THEN PERFORM public.crm_record_location_interest(m.id); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_apply_property_context_followup(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_property_context_followup(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
