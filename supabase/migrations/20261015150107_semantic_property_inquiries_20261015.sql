-- Verified semantic attribution uses the original inbound message, never a send
-- as a substitute for customer interest. The Edge verifier establishes the
-- property meaning; this transaction enforces provenance, privacy and integrity.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.property_message_attributions
 ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.property_message_attributions
 DROP CONSTRAINT IF EXISTS property_message_attributions_method_check;
ALTER TABLE public.property_message_attributions
 ADD CONSTRAINT property_message_attributions_method_check
 CHECK (method IN ('exact_link','exact_code','manual','ai_verified'));

-- The existing recursive classifier is deliberately not executable by service
-- callers. Expose only this bounded property check to the backend RPC.
CREATE OR REPLACE FUNCTION crm_repair_private.semantic_property_is_private(p_company uuid,p_property uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce((SELECT crm_repair_private.investment_link_is_private(p_company,to_jsonb(p))
  FROM public.properties p WHERE p.id=p_property AND p.company_id=p_company),true)
$$;
REVOKE ALL ON FUNCTION crm_repair_private.semantic_property_is_private(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_repair_private.semantic_property_is_private(uuid,uuid) TO service_role;

CREATE TABLE IF NOT EXISTS crm_repair_private.semantic_inquiry_backup_20261015(
 object_identity text PRIMARY KEY,original_definition text NOT NULL,applied_definition text,
 captured_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE crm_repair_private.semantic_inquiry_backup_20261015 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.semantic_inquiry_backup_20261015 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.semantic_inquiry_backup_20261015(object_identity,original_definition)
SELECT 'public.refresh_client_request_summary(uuid)',pg_get_functiondef('public.refresh_client_request_summary(uuid)'::regprocedure)
ON CONFLICT(object_identity) DO NOTHING;
DO $patch$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.refresh_client_request_summary(uuid)'::regprocedure);
 IF position('crm.semantic_parent_client' IN definition)=0 THEN
  IF position('client_type = v_current.request_type,' IN definition)=0 THEN RAISE EXCEPTION 'request summary definition changed; review semantic guard';END IF;
  definition:=replace(definition,'client_type = v_current.request_type,',$replacement$client_type = CASE
      WHEN current_setting('crm.semantic_parent_client',true)=c.id::text AND auth.uid() IS NULL
       AND (current_setting('role',true) IN ('service_role','postgres') OR (session_user='postgres' AND current_setting('role',true)='none'))
       AND nullif(btrim(c.client_type),'') IS NOT NULL THEN c.client_type
      ELSE v_current.request_type END,$replacement$);
  EXECUTE definition;
 END IF;
 UPDATE crm_repair_private.semantic_inquiry_backup_20261015
  SET applied_definition=pg_get_functiondef('public.refresh_client_request_summary(uuid)'::regprocedure)
  WHERE object_identity='public.refresh_client_request_summary(uuid)';
END $patch$;

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
  'bedrooms',p.bedrooms,'land_size',p.land_size,'built_size',p.built_size,'property_code',p.property_code,
  'images',coalesce(to_jsonb(p.images),'[]'::jsonb),'marketing_urls',coalesce((SELECT jsonb_agg(e.url ORDER BY e.id)
   FROM public.property_marketing_events e WHERE e.company_id=m.company_id AND e.property_id=p.id AND e.url IS NOT NULL),'[]'::jsonb)) ORDER BY p.id),'[]'::jsonb),
  'has_more',(SELECT count(*) FROM candidates)>p_limit) INTO result FROM page p;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.crm_property_inquiry_candidates(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_property_inquiry_candidates(uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_apply_verified_property_inquiries(
 p_message_id uuid,p_matches jsonb,p_needs_review boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $function$
DECLARE m public.whatsapp_messages%rowtype; w public.whatsapp_conversations%rowtype;
 c public.clients%rowtype; p public.properties%rowtype; s public.whatsapp_messages%rowtype;
 item jsonb; ev jsonb; source_id uuid; source_ids uuid[]; ids uuid[]:='{}'; prior_ids uuid[];
 prop_id uuid; inq_id uuid; first_id uuid; event_id uuid; v_at timestamptz; kind text;
 before_inq public.property_inquiries%rowtype; parent_before jsonb; parent_after jsonb;
 private_work boolean; support_count integer; total_count integer; new_count integer:=0;
 pending boolean; classification_sale boolean:=true; blocked text; previous_parent_context text;
BEGIN
 IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches)>8
   OR octet_length(p_matches::text)>32768 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_verified_property_matches';
 END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='inbound_message_required';END IF;
 -- Same client-before-message lock order as the established recorder/finalizer.
 SELECT * INTO c FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_message_client';END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound' FOR UPDATE;
 SELECT * INTO w FROM public.whatsapp_conversations
  WHERE id=m.conversation_id AND company_id=m.company_id AND client_id=m.client_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_message_conversation';END IF;
 v_at:=coalesce(m.message_timestamp,m.created_at);
 private_work:=w.route_key='investment' OR coalesce(c.lead_route='investment',false);
 parent_before:=to_jsonb(c);
 SELECT coalesce(array_agg(property_id),'{}'::uuid[]) INTO prior_ids
  FROM public.property_message_attributions WHERE company_id=m.company_id AND message_id=m.id;

 -- Conflicting parent identity remains pending instead of being silently
 -- reassigned by request-summary/geographic triggers during finalization.
 IF w.route_key NOT IN ('muscat','barka','investment') OR w.route_key IS NULL OR
   (NOT private_work AND (c.lead_route IS DISTINCT FROM w.route_key OR NOT EXISTS(
    SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=m.company_id
     AND r.route_key=w.route_key AND r.is_active=true AND r.assigned_to=c.assigned_to))) OR
   (c.lead_route='investment' AND w.route_key<>'investment') OR
   (private_work AND NOT EXISTS(SELECT 1 FROM public.company_lead_routes r JOIN public.profiles o ON o.id=r.assigned_to AND o.company_id=r.company_id
    WHERE r.company_id=m.company_id AND r.route_key='investment' AND r.is_active AND r.owner_only_inbox
     AND o.role='owner' AND o.is_active AND w.assigned_to=o.id)) THEN
  RETURN jsonb_build_object('matched_count',0,'property_ids','[]'::jsonb,'review_required',true,'blocked_reason','parent_route_conflict');
 END IF;

 -- A protected conflict rolls back this complete attribution batch, including
 -- request triggers. Database errors are deliberately not swallowed.
 BEGIN
 previous_parent_context:=current_setting('crm.semantic_parent_client',true);
 PERFORM set_config('crm.semantic_parent_client',m.client_id::text,true);
 FOR item IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'method' IS DISTINCT FROM 'ai_verified'
   OR jsonb_typeof(item->'evidence') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_verified_property_match';END IF;
  prop_id:=(item->>'property_id')::uuid; ev:=item->'evidence'; kind:=ev->>'kind';
  IF prop_id IS NULL OR kind NOT IN ('text','image','conversation') OR kind IS NULL
    OR jsonb_typeof(ev->'source_message_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(ev->'source_message_ids') NOT BETWEEN 1 AND 6
    OR length(btrim(coalesce(ev->>'quote','')))=0 OR length(ev->>'quote')>6000
    OR jsonb_typeof(ev->'matched_facts') NOT IN ('object','array')
    OR ev->'matched_facts' IN ('{}'::jsonb,'[]'::jsonb) OR ev->'matched_facts' IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_property_evidence';END IF;
  IF prop_id=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_property_match';END IF;
  SELECT * INTO p FROM public.properties WHERE id=prop_id AND company_id=m.company_id;
  IF NOT FOUND OR (NOT private_work AND (p.branch_key IS DISTINCT FROM w.route_key
    OR crm_repair_private.semantic_property_is_private(m.company_id,p.id))) THEN
   RAISE EXCEPTION USING ERRCODE='P8220',MESSAGE='property_branch_conflict';END IF;
  classification_sale:=classification_sale AND
    concat_ws(' ',p.title,p.description,p.public_details) ~* '(للبيع|for sale)' AND
    concat_ws(' ',p.title,p.description,p.public_details) !~* '(للإيجار|للايجار|للاستئجار|for rent|rental|rent)';
  SELECT array_agg(value::uuid) INTO source_ids FROM jsonb_array_elements_text(ev->'source_message_ids');
  IF NOT m.id=ANY(source_ids) OR cardinality(source_ids)<>(SELECT count(DISTINCT x) FROM unnest(source_ids) x)
    OR (kind IN ('text','image') AND cardinality(source_ids)<>1)
    OR (kind='image' AND m.message_type<>'image') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_property_evidence_sources';END IF;
  support_count:=0;
  FOREACH source_id IN ARRAY source_ids LOOP
   IF source_id=m.id THEN CONTINUE;END IF;
   SELECT * INTO s FROM public.whatsapp_messages WHERE id=source_id AND company_id=m.company_id
    AND conversation_id=m.conversation_id AND client_id=m.client_id;
   IF NOT FOUND OR s.direction<>'outbound' OR s.actor_type IS DISTINCT FROM 'human'
     OR lower(coalesce(s.delivery_status,'')) IN ('failed','undelivered','rejected') OR coalesce(s.message_timestamp,s.created_at) IS NULL
     OR abs(extract(epoch FROM coalesce(s.message_timestamp,s.created_at)-v_at))>86400 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_property_support_message';END IF;
   -- Meta uses second-resolution timestamps; a real quoted inbound may have
   -- the same timestamp as its source. Historical CRM replies may store UUIDs.
   IF m.reply_to_message_id=s.whatsapp_message_id OR m.reply_to_message_id=s.id::text THEN
    NULL;
   ELSIF coalesce(s.message_timestamp,s.created_at)<v_at THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unrelated_prior_property_message';
   ELSIF s.reply_to_message_id IS NOT NULL AND s.reply_to_message_id IS DISTINCT FROM m.whatsapp_message_id
     AND s.reply_to_message_id IS DISTINCT FROM m.id::text THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unrelated_property_response';
   END IF;
   support_count:=support_count+1;
  END LOOP;
  IF kind='conversation' AND support_count=0 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='property_response_required';END IF;
  IF kind='text' AND position(ev->>'quote' IN coalesce(m.body,''))=0 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='property_quote_not_in_message';END IF;
  IF kind='conversation' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_messages sm
    WHERE sm.id=ANY(source_ids) AND sm.id<>m.id AND position(ev->>'quote' IN coalesce(sm.body,''))>0) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='property_quote_not_in_response';END IF;

  -- Capture the exact recorder target before it is promoted from visit-derived
  -- interest, so first/last inquiry dates reflect actual inbound evidence only.
  SELECT i.* INTO before_inq FROM public.property_inquiries i
   WHERE i.company_id=m.company_id AND i.client_id=m.client_id AND i.property_id=p.id
   AND i.request_id IS NOT DISTINCT FROM (SELECT r.id FROM public.client_requests r
    WHERE r.company_id=m.company_id AND r.client_id=m.client_id AND r.subject_property_id=p.id AND r.status='active'
     AND private_work=(coalesce(r.route_key='investment',false) OR coalesce(r.branch_key='investment',false))
    ORDER BY r.created_at LIMIT 1)
   ORDER BY i.created_at LIMIT 1;
  inq_id:=public.record_property_link_inquiry_internal(m.company_id,m.client_id,p.id,NULL,m.id,
    left(ev->>'quote',6000),'ai-property:'||p.id::text,v_at,false);
  IF NOT p.id=ANY(prior_ids) THEN
   UPDATE public.property_inquiries SET
    first_inquiry_at=CASE WHEN before_inq.id=inq_id AND before_inq.has_inbound_inquiry
      THEN least(before_inq.first_inquiry_at,v_at) ELSE v_at END,
    last_inquiry_at=CASE WHEN before_inq.id=inq_id AND before_inq.has_inbound_inquiry
      THEN greatest(before_inq.last_inquiry_at,v_at) ELSE v_at END
    WHERE id=inq_id AND company_id=m.company_id;
   UPDATE public.property_message_attributions SET evidence=ev||jsonb_build_object('version',1)
    WHERE company_id=m.company_id AND message_id=m.id AND property_id=p.id AND method='ai_verified';
   new_count:=new_count+1;
  END IF;
  ids:=array_append(ids,p.id);
 END LOOP;
 IF cardinality(ids)>0 THEN PERFORM public.crm_finalize_property_message(m.id);END IF;
 SELECT to_jsonb(x) INTO parent_after FROM public.clients x WHERE id=m.client_id AND company_id=m.company_id;
 IF parent_after IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['lead_route','assigned_to','name','phone','phone_normalized','created_at']) fields(field_name)
   WHERE parent_before->fields.field_name IS DISTINCT FROM parent_after->fields.field_name) THEN
  RAISE EXCEPTION USING ERRCODE='P8220',MESSAGE='parent_identity_conflict';END IF;
 IF parent_before->'client_type' IS DISTINCT FROM parent_after->'client_type' AND NOT(
   nullif(btrim(parent_before->>'client_type'),'') IS NULL AND parent_after->>'client_type'='buyer' AND classification_sale) THEN
  RAISE EXCEPTION USING ERRCODE='P8220',MESSAGE='parent_classification_conflict';END IF;

 -- A semantic match resolves only the generic text/photo reference. Unrelated
 -- pasted URLs/codes stay pending; no blanket resolution of the whole message.
 IF cardinality(ids)>0 AND NOT coalesce(p_needs_review,false) THEN
  UPDATE public.unmatched_property_links SET status='resolved',
   property_id=CASE WHEN cardinality(ids)=1 THEN ids[1] ELSE NULL END,
   resolved_at=now(),resolved_by=NULL,updated_at=now()
  WHERE company_id=m.company_id AND whatsapp_message_id=m.id AND status='pending'
    AND link_key IN ('text:'||m.id::text,'image:'||m.id::text);
 END IF;
 SELECT count(*),(array_agg(a.property_id ORDER BY a.created_at,a.id))[1],
  (array_agg(a.marketing_event_id ORDER BY a.created_at,a.id))[1]
  INTO total_count,first_id,event_id FROM public.property_message_attributions a
  WHERE a.company_id=m.company_id AND a.message_id=m.id;
 pending:=coalesce(p_needs_review,false) OR EXISTS(SELECT 1 FROM public.unmatched_property_links u
  WHERE u.company_id=m.company_id AND u.whatsapp_message_id=m.id AND u.status='pending');
 IF total_count>0 THEN
  UPDATE public.whatsapp_messages SET
   matched_property_id=CASE WHEN total_count=1 THEN first_id ELSE NULL END,
   matched_marketing_event_id=CASE WHEN total_count=1 THEN event_id ELSE NULL END,
   property_match_status=CASE WHEN pending THEN 'partial_match' WHEN total_count>1 THEN 'multiple_matched' ELSE 'auto_matched' END,
   property_link_key=CASE WHEN total_count=1 THEN property_link_key ELSE NULL END
   WHERE id=m.id AND company_id=m.company_id;
 END IF;
 PERFORM set_config('crm.semantic_parent_client',coalesce(previous_parent_context,''),true);
 RETURN jsonb_build_object('matched_count',new_count,'property_ids',to_jsonb(ids),'review_required',pending,'blocked_reason',NULL);
 EXCEPTION WHEN SQLSTATE 'P8220' THEN
  GET STACKED DIAGNOSTICS blocked=MESSAGE_TEXT;
  RETURN jsonb_build_object('matched_count',0,'property_ids','[]'::jsonb,'review_required',true,'blocked_reason',blocked);
 END;
END $function$;
REVOKE ALL ON FUNCTION public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean) TO service_role;
