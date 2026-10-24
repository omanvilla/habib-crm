-- SQL42: "needs human intervention" queue and one-step classification.
--
-- The dashboard shows every WhatsApp conversation that has inbound evidence the
-- system could not attribute (images, links, text in unmatched_property_links)
-- or that the automation handed to a human. Staff then classify the inquiry:
--   property         one or more existing properties (multiple allowed)
--   general          a general request, no specific listing
--   non_real_estate  not about real estate (job seekers, suppliers, ...)
--   unavailable      about a listing that is no longer available
--   other            anything else (note required)
-- Access is the same as resolve_unmatched_property_link: the caller must be able
-- to open the exact conversation (branch separation, investment owner-only) and
-- every chosen property must be in a branch the caller may use.

ALTER TABLE public.unmatched_property_links
  ADD COLUMN IF NOT EXISTS resolution_kind text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS ai_suggestion jsonb,
  ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE public.unmatched_property_links DROP CONSTRAINT IF EXISTS unmatched_property_links_resolution_kind_chk;
ALTER TABLE public.unmatched_property_links ADD CONSTRAINT unmatched_property_links_resolution_kind_chk
  CHECK (resolution_kind IS NULL OR resolution_kind IN ('property','general','non_real_estate','unavailable','other'));

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS inquiry_classification text,
  ADD COLUMN IF NOT EXISTS inquiry_classification_note text,
  ADD COLUMN IF NOT EXISTS inquiry_classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS inquiry_classified_by uuid;
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_inquiry_classification_chk;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_inquiry_classification_chk
  CHECK (inquiry_classification IS NULL OR inquiry_classification IN ('property','general','non_real_estate','unavailable','other'));

CREATE INDEX IF NOT EXISTS unmatched_property_links_pending_conv_idx
  ON public.unmatched_property_links (company_id, conversation_id, last_seen_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS whatsapp_conversations_handoff_idx
  ON public.whatsapp_conversations (company_id, handoff_updated_at DESC) WHERE human_handoff_required;

CREATE OR REPLACE FUNCTION public.crm_attention_queue(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_company uuid:=public.my_company(); v_role text:=public.my_role(); v_owner boolean; v_result jsonb;
 v_limit int:=least(greatest(coalesce(p_limit,20),1),100); v_offset int:=greatest(coalesce(p_offset,0),0);
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 v_owner:=v_role='owner';
 WITH pending AS (
  SELECT u.conversation_id, count(*) AS n,
   count(*) FILTER (WHERE u.link_key LIKE 'image:%') AS images,
   count(*) FILTER (WHERE u.link_key LIKE 'text:%') AS texts,
   count(*) FILTER (WHERE u.link_key NOT LIKE 'image:%' AND u.link_key NOT LIKE 'text:%') AS links,
   max(u.last_seen_at) AS latest_at,
   (array_agg(u.id ORDER BY u.last_seen_at DESC, u.id))[1:30] AS ids,
   (array_agg(left(u.raw_url,180) ORDER BY u.last_seen_at DESC, u.id))[1] AS sample,
   (array_agg(u.ai_suggestion ORDER BY u.ai_checked_at DESC NULLS LAST, u.id) FILTER (WHERE u.ai_suggestion IS NOT NULL))[1] AS ai
  FROM public.unmatched_property_links u
  WHERE u.company_id=v_company AND u.status='pending' AND u.conversation_id IS NOT NULL
  GROUP BY u.conversation_id
 ), convs AS (
  SELECT w.id, w.client_id, w.route_key, w.customer_name, w.customer_phone, w.human_handoff_required, w.handoff_reason,
   w.handoff_updated_at, w.inquiry_classification, p.n, p.images, p.texts, p.links, p.ids, p.sample, p.ai,
   greatest(p.latest_at, CASE WHEN w.human_handoff_required THEN w.handoff_updated_at END) AS latest_at
  FROM public.whatsapp_conversations w
  LEFT JOIN pending p ON p.conversation_id=w.id
  WHERE w.company_id=v_company AND (p.conversation_id IS NOT NULL OR w.human_handoff_required)
   AND coalesce(w.inquiry_classification,'')<>'non_real_estate'
 ), visible AS (
  SELECT c.* FROM convs c
  WHERE v_owner OR crm_repair_private.can_access_whatsapp_conversation(v_company, c.id)
 ), page AS (
  SELECT v.*, cl.name AS client_name FROM visible v
  LEFT JOIN public.clients cl ON cl.id=v.client_id AND cl.company_id=v_company
  ORDER BY v.latest_at DESC NULLS LAST, v.id
  LIMIT v_limit OFFSET v_offset
 )
 SELECT jsonb_build_object(
  'total_conversations',(SELECT count(*) FROM visible),
  'total_items',(SELECT coalesce(sum(n),0) FROM visible),
  'handoff_conversations',(SELECT count(*) FROM visible WHERE human_handoff_required),
  'images',(SELECT coalesce(sum(images),0) FROM visible),
  'links',(SELECT coalesce(sum(links),0) FROM visible),
  'texts',(SELECT coalesce(sum(texts),0) FROM visible),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'conversation_id',pg.id,'client_id',pg.client_id,'route_key',pg.route_key,
    'name',coalesce(nullif(pg.client_name,''),nullif(pg.customer_name,''),pg.customer_phone,'عميل واتساب'),
    'phone',pg.customer_phone,'pending_count',coalesce(pg.n,0),'images',coalesce(pg.images,0),
    'links',coalesce(pg.links,0),'texts',coalesce(pg.texts,0),'latest_at',pg.latest_at,
    'sample',pg.sample,'unmatched_ids',coalesce(to_jsonb(pg.ids),'[]'::jsonb),
    'handoff',pg.human_handoff_required,'handoff_reason',pg.handoff_reason,'ai_suggestion',pg.ai)
    ORDER BY pg.latest_at DESC NULLS LAST, pg.id) FROM page pg),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_classify_inquiry(
  p_conversation_id uuid, p_kind text, p_property_ids uuid[] DEFAULT NULL, p_note text DEFAULT NULL, p_unmatched_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_company uuid:=public.my_company(); v_role text:=public.my_role(); w public.whatsapp_conversations%rowtype;
 u public.unmatched_property_links%rowtype; v_props uuid[]; v_prop uuid; v_note text:=nullif(btrim(coalesce(p_note,'')),'');
 v_marketing uuid; v_existing uuid; v_linkkey text; v_items int:=0; v_anchor uuid; v_body text; v_at timestamptz; v_msgs uuid[]:='{}'; v_msg uuid;
 v_cleared boolean:=false;
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('property','general','non_real_estate','unavailable','other') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
 IF p_kind='other' AND v_note IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
 IF v_note IS NOT NULL AND length(v_note)>1000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
 SELECT * INTO w FROM public.whatsapp_conversations WHERE id=p_conversation_id AND company_id=v_company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,w.id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 IF w.client_id IS NULL THEN RAISE EXCEPTION 'conversation_has_no_client'; END IF;

 SELECT coalesce(array_agg(DISTINCT x),'{}') INTO v_props FROM unnest(coalesce(p_property_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
 IF p_kind='property' AND cardinality(v_props)=0 THEN RAISE EXCEPTION 'property_required'; END IF;
 IF cardinality(v_props)>10 THEN RAISE EXCEPTION 'too_many_properties'; END IF;
 IF p_kind NOT IN ('property','unavailable') AND cardinality(v_props)>0 THEN RAISE EXCEPTION 'properties_not_expected'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_props) x WHERE NOT EXISTS(
   SELECT 1 FROM public.properties pr WHERE pr.id=x AND pr.company_id=v_company AND crm_repair_private.staff_can_access_branch(pr.company_id,pr.branch_key)))
 THEN RAISE EXCEPTION 'invalid_property'; END IF;

 IF p_kind='property' THEN
  FOR u IN SELECT * FROM public.unmatched_property_links
    WHERE company_id=v_company AND conversation_id=w.id AND status='pending'
     AND (p_unmatched_ids IS NULL OR id=ANY(p_unmatched_ids))
    ORDER BY first_seen_at, id FOR UPDATE LOOP
   v_marketing:=NULL;
   -- A link can only be mapped to one listing; map it only for a single-property answer.
   IF cardinality(v_props)=1 THEN
    v_linkkey:=public.normalize_property_marketing_link(u.raw_url);
    IF v_linkkey IS NOT NULL THEN
     v_existing:=NULL;
     SELECT id,property_id INTO v_marketing,v_existing FROM public.property_marketing_events WHERE company_id=v_company AND link_key=v_linkkey;
     IF v_existing IS NOT NULL AND v_existing<>v_props[1] THEN v_marketing:=NULL;
     ELSIF v_marketing IS NULL THEN
      INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,notes,created_by,auto_sync,sync_status)
      VALUES(v_company,v_props[1],coalesce(public.property_link_provider(u.raw_url),'other'),'publish',u.raw_url,'تم تأكيد الرابط بواسطة موظف',auth.uid(),false,'manual')
      RETURNING id INTO v_marketing;
     END IF;
    END IF;
   END IF;
   FOREACH v_prop IN ARRAY v_props LOOP
    PERFORM public.record_property_link_inquiry_internal(v_company,u.client_id,v_prop,v_marketing,u.whatsapp_message_id,u.raw_url,u.link_key,u.first_seen_at,true);
   END LOOP;
   v_msgs:=array_append(v_msgs,u.whatsapp_message_id);
   UPDATE public.unmatched_property_links SET status='resolved',resolution_kind='property',resolution_note=v_note,property_id=v_props[1],
    marketing_event_id=v_marketing,resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
   v_items:=v_items+1;
  END LOOP;
  -- A handed-off conversation may have no pending evidence row: anchor on its latest inbound message.
  IF v_items=0 THEN
   SELECT id,left(coalesce(body,transcript,''),500),message_timestamp INTO v_anchor,v_body,v_at FROM public.whatsapp_messages
    WHERE company_id=v_company AND conversation_id=w.id AND client_id=w.client_id AND direction='inbound'
    ORDER BY message_timestamp DESC NULLS LAST, created_at DESC LIMIT 1;
   IF v_anchor IS NULL THEN RAISE EXCEPTION 'no_inbound_message'; END IF;
   FOREACH v_prop IN ARRAY v_props LOOP
    PERFORM public.record_property_link_inquiry_internal(v_company,w.client_id,v_prop,NULL,v_anchor,nullif(v_body,''),'manual-review:'||w.id::text,v_at,true);
   END LOOP;
   v_msgs:=array_append(v_msgs,v_anchor);
  END IF;
  FOREACH v_msg IN ARRAY (SELECT array_agg(DISTINCT m) FROM unnest(v_msgs) m) LOOP
   PERFORM public.crm_finalize_property_message(v_msg);
   UPDATE public.whatsapp_messages SET matched_property_id=coalesce(matched_property_id,v_props[1]),property_match_status='resolved_manual'
    WHERE id=v_msg AND company_id=v_company;
  END LOOP;
 ELSE
  UPDATE public.unmatched_property_links SET status=CASE WHEN p_kind='non_real_estate' THEN 'ignored' ELSE 'resolved' END,
    resolution_kind=p_kind,resolution_note=v_note,property_id=CASE WHEN p_kind='unavailable' THEN v_props[1] END,
    resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE company_id=v_company AND conversation_id=w.id AND status='pending' AND (p_unmatched_ids IS NULL OR id=ANY(p_unmatched_ids));
  GET DIAGNOSTICS v_items=ROW_COUNT;
 END IF;

 -- Clear an automation hand-off that only asked staff to identify the property,
 -- or any hand-off for a conversation that is not about real estate. A customer's
 -- explicit request for a person stays open until staff clear it in the inbox.
 IF w.human_handoff_required AND (p_kind='non_real_estate' OR coalesce(w.handoff_reason,'') LIKE '%تحديد%') THEN v_cleared:=true; END IF;
 UPDATE public.whatsapp_conversations SET inquiry_classification=p_kind,inquiry_classification_note=v_note,inquiry_classified_at=now(),
   inquiry_classified_by=auth.uid(),
   human_handoff_required=CASE WHEN v_cleared THEN false ELSE human_handoff_required END,
   handoff_reason=CASE WHEN v_cleared THEN NULL ELSE handoff_reason END,
   handoff_updated_at=CASE WHEN v_cleared THEN now() ELSE handoff_updated_at END,
   updated_at=now()
  WHERE id=w.id;
 RETURN jsonb_build_object('ok',true,'kind',p_kind,'items',v_items,'properties',to_jsonb(v_props),'handoff_cleared',v_cleared);
END
$function$;

REVOKE ALL ON FUNCTION public.crm_attention_queue(integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_classify_inquiry(uuid,text,uuid[],text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_attention_queue(integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_classify_inquiry(uuid,text,uuid[],text,uuid[]) TO authenticated, service_role;
