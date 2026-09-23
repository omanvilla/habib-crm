-- Additive acquisition attribution. Apply in one transaction after snapshots.
-- No outbound communication; no historical request inference/backfill.
CREATE TABLE IF NOT EXISTS public.property_message_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  marketing_event_id uuid REFERENCES public.property_marketing_events(id) ON DELETE SET NULL,
  inquiry_id uuid REFERENCES public.property_inquiries(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.client_requests(id) ON DELETE SET NULL,
  evidence_key text NOT NULL,
  source_url text,
  method text NOT NULL CHECK (method IN ('exact_link','exact_code','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,message_id,property_id)
);
ALTER TABLE public.property_message_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_message_attributions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_message_attributions TO authenticated;
GRANT ALL ON public.property_message_attributions TO service_role;
CREATE POLICY property_message_attributions_read ON public.property_message_attributions
 FOR SELECT TO authenticated USING (
 company_id=(SELECT public.my_company()) AND EXISTS (
 SELECT 1 FROM public.whatsapp_messages wm WHERE wm.id=property_message_attributions.message_id AND wm.company_id=property_message_attributions.company_id));
CREATE INDEX IF NOT EXISTS property_message_attributions_property_idx ON public.property_message_attributions(company_id,property_id,request_id);

CREATE OR REPLACE FUNCTION public.normalize_property_marketing_link(p_url text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $f$
DECLARE u text:=trim(coalesce(p_url,'')); m text[];
BEGIN
 u:=regexp_replace(replace(u,'&amp;','&'),'[\]\)\}>,.;!؟،]+$','','g');
 -- Host is insensitive, shortcodes and video IDs are case sensitive.
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?(?:instagram\.com|instagr\.am)/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?instagram\.com/share/(?:reel|p)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram-share:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/shorts/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/watch\?[^#]*\mv=([A-Za-z0-9_-]+)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 RETURN NULL;
END $f$;

CREATE OR REPLACE FUNCTION public.property_link_provider(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $f$
 SELECT CASE WHEN public.normalize_property_marketing_link(p_url) LIKE 'instagram%' THEN 'instagram'
 WHEN public.normalize_property_marketing_link(p_url) LIKE 'youtube:%' THEN 'youtube' ELSE NULL END
$f$;

-- Recompute existing keys from URLs. Never lowercase the stored URL or media ID.
-- Canonical identity also wins over old in-flight metric-sync writers at cutover.
DROP TRIGGER IF EXISTS trg_property_marketing_link_identity ON public.property_marketing_events;
CREATE TRIGGER trg_property_marketing_link_identity BEFORE INSERT OR UPDATE OF url,link_key,link_provider
 ON public.property_marketing_events FOR EACH ROW EXECUTE FUNCTION public.set_property_marketing_link_identity();
UPDATE public.property_marketing_events SET link_key=public.normalize_property_marketing_link(url),link_provider=public.property_link_provider(url)
WHERE link_key IS DISTINCT FROM public.normalize_property_marketing_link(url) OR link_provider IS DISTINCT FROM public.property_link_provider(url);
UPDATE public.unmatched_property_links SET link_key=public.normalize_property_marketing_link(raw_url)
WHERE public.normalize_property_marketing_link(raw_url) IS NOT NULL AND link_key IS DISTINCT FROM public.normalize_property_marketing_link(raw_url);

CREATE OR REPLACE FUNCTION public.record_property_link_inquiry_internal(
 p_company_id uuid,p_client_id uuid,p_property_id uuid,p_marketing_event_id uuid,
 p_whatsapp_message_id uuid,p_raw_url text,p_link_key text,p_message_at timestamptz,p_manual boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_attr public.property_message_attributions%rowtype; v_inq public.property_inquiries%rowtype;
 v_request uuid; v_assigned uuid; v_source text; v_at timestamptz:=coalesce(p_message_at,now());
BEGIN
 -- Serialize messages from one client without assuming their other requests match this property.
 SELECT assigned_to INTO v_assigned FROM public.clients WHERE id=p_client_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id AND direction='inbound')
 THEN RAISE EXCEPTION 'invalid_attribution_relationship'; END IF;
 IF p_marketing_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id AND property_id=p_property_id)
 THEN RAISE EXCEPTION 'invalid_marketing_relationship'; END IF;
 SELECT * INTO v_attr FROM public.property_message_attributions WHERE company_id=p_company_id AND message_id=p_whatsapp_message_id AND property_id=p_property_id;
 IF FOUND THEN RETURN v_attr.inquiry_id; END IF;
 SELECT r.id INTO v_request FROM public.client_requests r WHERE company_id=p_company_id AND client_id=p_client_id AND subject_property_id=p_property_id AND status='active' ORDER BY created_at LIMIT 1;
 SELECT * INTO v_inq FROM public.property_inquiries WHERE company_id=p_company_id AND client_id=p_client_id AND property_id=p_property_id
 AND request_id IS NOT DISTINCT FROM v_request ORDER BY created_at LIMIT 1 FOR UPDATE;
 SELECT CASE channel WHEN 'instagram' THEN 'instagram' WHEN 'youtube' THEN 'youtube' ELSE 'whatsapp' END INTO v_source
 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id;
 v_source:=coalesce(v_source,'whatsapp');
 IF v_inq.id IS NOT NULL THEN
   UPDATE public.property_inquiries SET has_inbound_inquiry=true,
    source=CASE WHEN NOT has_inbound_inquiry OR source='other' THEN v_source ELSE source END,
    source_detail=CASE WHEN p_manual THEN 'تحديد العقار بمراجعة الموظف' ELSE 'استفسار وارد عن عقار محدد' END,
    source_url=p_raw_url,source_whatsapp_message_id=p_whatsapp_message_id,
    marketing_event_id=coalesce(p_marketing_event_id,marketing_event_id),
    last_inquiry_at=greatest(last_inquiry_at,v_at),
    inquiry_count=CASE WHEN has_inbound_inquiry THEN inquiry_count+1 ELSE 1 END,last_message=left(p_raw_url,6000),updated_at=now()
   WHERE id=v_inq.id RETURNING * INTO v_inq;
 ELSE
   INSERT INTO public.property_inquiries(company_id,client_id,property_id,assigned_to,source,source_detail,status,first_inquiry_at,last_inquiry_at,
    inquiry_count,last_message,request_id,is_first_attraction,shown_by_agent,has_inbound_inquiry,marketing_event_id,source_url,source_whatsapp_message_id)
   VALUES(p_company_id,p_client_id,p_property_id,v_assigned,v_source,'استفسار وارد عن عقار محدد','inquiry',v_at,v_at,1,left(p_raw_url,6000),v_request,
    NOT EXISTS(SELECT 1 FROM public.property_inquiries WHERE company_id=p_company_id AND client_id=p_client_id AND has_inbound_inquiry),false,true,p_marketing_event_id,p_raw_url,p_whatsapp_message_id)
   RETURNING * INTO v_inq;
 END IF;
 INSERT INTO public.property_message_attributions(company_id,message_id,client_id,property_id,marketing_event_id,inquiry_id,request_id,evidence_key,source_url,method)
 VALUES(p_company_id,p_whatsapp_message_id,p_client_id,p_property_id,p_marketing_event_id,v_inq.id,v_request,p_link_key,p_raw_url,
 CASE WHEN p_manual THEN 'manual' WHEN p_link_key LIKE 'property-code:%' THEN 'exact_code' ELSE 'exact_link' END);
 RETURN v_inq.id;
END $f$;
REVOKE ALL ON FUNCTION public.record_property_link_inquiry_internal(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_property_link_inquiry_internal(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.process_property_links_from_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r text[]; v_url text; v_key text; v_provider text; v_marketing record; v_property uuid;
 v_matched int:=0; v_unmatched int:=0; v_first_property uuid; v_first_marketing uuid; v_seen text[]:='{}'; v_evidence text;
BEGIN
 IF new.direction<>'inbound' OR new.client_id IS NULL THEN RETURN new; END IF;
 -- Preserve both pasted URLs and authenticated Meta click-to-WhatsApp referral URLs.
 v_evidence:=coalesce(new.body,'')||' '||coalesce(new.raw_payload->'referral'->>'source_url','');
 FOR r IN SELECT regexp_matches(v_evidence,'((?:https?://|www\.)[^[:space:]<>"'']+)','gi') LOOP
  v_url:=r[1]; v_key:=public.normalize_property_marketing_link(v_url);
  IF v_key IS NULL OR v_key=ANY(v_seen) THEN CONTINUE; END IF;
  v_seen:=array_append(v_seen,v_key); v_provider:=public.property_link_provider(v_url);
  SELECT m.id,m.property_id INTO v_marketing FROM public.property_marketing_events m
  WHERE m.company_id=new.company_id AND m.link_key=v_key LIMIT 1;
  IF v_marketing.id IS NOT NULL THEN
   PERFORM public.record_property_link_inquiry_internal(new.company_id,new.client_id,v_marketing.property_id,v_marketing.id,new.id,v_url,v_key,coalesce(new.message_timestamp,new.created_at),false);
   v_matched:=v_matched+1; v_first_property:=coalesce(v_first_property,v_marketing.property_id); v_first_marketing:=coalesce(v_first_marketing,v_marketing.id);
  ELSE
   INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,inbound_number,raw_url,link_key,provider,status,first_seen_at,last_seen_at)
   VALUES(new.company_id,new.client_id,new.conversation_id,new.id,new.recipient_wa_id,v_url,v_key,v_provider,'pending',coalesce(new.message_timestamp,now()),coalesce(new.message_timestamp,now()))
   ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
   v_unmatched:=v_unmatched+1;
  END IF;
 END LOOP;
 FOR r IN SELECT regexp_matches(v_evidence,'(?:property-code:|رمز[[:space:]]+العقار[[:space:]:]+)([A-Za-z0-9_-]{3,80})','gi') LOOP
  v_key:='property-code:'||r[1];
  IF v_key=ANY(v_seen) THEN CONTINUE; END IF; v_seen:=array_append(v_seen,v_key);
  SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO v_property FROM public.properties
  WHERE company_id=new.company_id AND (lower(property_code)=lower(r[1]) OR id::text=lower(r[1]));
  IF v_property IS NOT NULL THEN
   PERFORM public.record_property_link_inquiry_internal(new.company_id,new.client_id,v_property,NULL,new.id,v_key,v_key,coalesce(new.message_timestamp,new.created_at),false);
   v_matched:=v_matched+1; v_first_property:=coalesce(v_first_property,v_property);
  ELSE
   INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,raw_url,link_key,provider,status)
   VALUES(new.company_id,new.client_id,new.conversation_id,new.id,v_key,v_key,'other','pending') ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
   v_unmatched:=v_unmatched+1;
  END IF;
 END LOOP;
 -- A photo or an underspecified 'this property' is reviewable evidence, never a guessed property identity.
 IF v_matched=0 AND v_unmatched=0 AND (new.message_type='image' OR coalesce(new.body,'') ~ '(هذا|هذي|هاذي|هذه).{0,15}(العقار|البيت|الفيلا)|تفاصيل.{0,15}(العقار|البيت|الفيلا)') THEN
  v_key:=CASE WHEN new.message_type='image' THEN 'image:' ELSE 'text:' END||new.id::text;
  INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,raw_url,link_key,provider,status)
  VALUES(new.company_id,new.client_id,new.conversation_id,new.id,coalesce(nullif(new.body,''),'صورة واردة تحتاج تحديد العقار'),v_key,'other','pending')
  ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
  v_unmatched:=1;
 END IF;
 IF v_matched>0 OR v_unmatched>0 THEN
  UPDATE public.whatsapp_messages SET matched_property_id=v_first_property,matched_marketing_event_id=v_first_marketing,
   property_match_status=CASE WHEN v_matched>0 AND v_unmatched>0 THEN 'partial_match' WHEN v_matched>1 THEN 'multiple_matched' WHEN v_matched=1 THEN 'auto_matched' ELSE 'pending_manual' END,
   property_link_key=CASE WHEN cardinality(v_seen)=1 THEN v_seen[1] ELSE NULL END WHERE id=new.id;
 END IF;
 RETURN new;
END $f$;
REVOKE ALL ON FUNCTION public.process_property_links_from_whatsapp() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_property_links_from_whatsapp() TO service_role;

CREATE OR REPLACE FUNCTION public.crm_finalize_property_message(p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE m public.whatsapp_messages%rowtype; a public.property_message_attributions%rowtype;
 p public.properties%rowtype; c public.clients%rowtype; v_req uuid; v_reqcount int; v_propcount int; v_inq uuid; v_n int:=0; v_type text;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION 'inbound_message_required'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_message_client'; END IF;
 SELECT count(*) INTO v_propcount FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id;
 FOR a IN SELECT * FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id ORDER BY property_id LOOP
  IF a.request_id IS NOT NULL THEN CONTINUE; END IF;
  SELECT * INTO p FROM public.properties WHERE id=a.property_id AND company_id=m.company_id;
  SELECT id INTO v_req FROM public.client_requests WHERE company_id=m.company_id AND client_id=m.client_id AND subject_property_id=p.id AND status='active' ORDER BY created_at LIMIT 1;
  IF v_req IS NULL AND v_propcount=1 THEN
   SELECT count(*),(array_agg(r.id))[1] INTO v_reqcount,v_req FROM public.client_requests r JOIN public.whatsapp_message_requests w ON w.request_id=r.id
   WHERE w.message_id=m.id AND w.company_id=m.company_id AND r.client_id=m.client_id AND r.company_id=m.company_id AND r.status='active'
    AND r.request_type IN ('buyer','tenant','investor') AND (r.subject_property_id IS NULL OR r.subject_property_id=p.id);
   IF v_reqcount<>1 THEN v_req:=NULL; END IF;
  END IF;
  IF v_req IS NULL THEN
   -- Do not infer financing, budget, readiness or bedrooms from a listing's price/specification.
   v_type:=CASE WHEN coalesce(m.body,'') ~ '(استئجار|للايجار|للإيجار|rent)' THEN 'tenant' ELSE 'buyer' END;
   INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
    assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
   VALUES(m.company_id,m.client_id,v_type,p.type,CASE WHEN p.type IS NULL THEN '{}'::text[] ELSE ARRAY[p.type] END,p.area,ARRAY[p.area],p.id,
    c.assigned_to,coalesce(p.branch_key,c.lead_route,'general'),coalesce(p.branch_key,c.lead_route,'general'),m.recipient_wa_id,
    CASE WHEN a.evidence_key LIKE 'instagram%' THEN 'instagram' ELSE 'whatsapp' END,'استفسار عن عقار محدد عبر واتساب','whatsapp',m.id,true,
    'مراجعة الاستفسار وتأكيد نوع الطلب والميزانية والتوقيت','تم تحديد العقار من دليل الرسالة؛ لا تعتبر بيانات الإعلان متطلبات صرح بها العميل') RETURNING id INTO v_req;
  ELSE
   UPDATE public.client_requests SET subject_property_id=coalesce(subject_property_id,p.id) WHERE id=v_req AND company_id=m.company_id;
  END IF;
  -- Reuse the inquiry already belonging to the selected request; preserve legacy rows and their history.
  SELECT id INTO v_inq FROM public.property_inquiries WHERE company_id=m.company_id AND request_id=v_req AND property_id=p.id LIMIT 1;
  IF v_inq IS NULL THEN
   UPDATE public.property_inquiries SET request_id=v_req WHERE id=a.inquiry_id AND company_id=m.company_id AND request_id IS NULL RETURNING id INTO v_inq;
  END IF;
  UPDATE public.property_message_attributions SET request_id=v_req,inquiry_id=coalesce(v_inq,inquiry_id) WHERE id=a.id;
  INSERT INTO public.whatsapp_message_requests(company_id,message_id,request_id,relation) VALUES(m.company_id,m.id,v_req,'mentioned') ON CONFLICT(message_id,request_id) DO NOTHING;
  v_n:=v_n+1;
 END LOOP;
 SELECT count(DISTINCT request_id),(array_agg(DISTINCT request_id))[1] INTO v_reqcount,v_req FROM public.whatsapp_message_requests WHERE message_id=m.id AND company_id=m.company_id;
 IF v_reqcount=1 THEN UPDATE public.whatsapp_messages SET request_id=v_req WHERE id=m.id; END IF;
 RETURN jsonb_build_object('ok',true,'linked_count',v_n,'property_count',v_propcount);
END $f$;
REVOKE ALL ON FUNCTION public.crm_finalize_property_message(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finalize_property_message(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_unmatched_property_link(p_unmatched_id uuid,p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE u public.unmatched_property_links%rowtype; v_company uuid:=public.my_company(); v_role text:=public.my_role();
 v_marketing uuid; v_existing uuid; v_linkkey text;
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO u FROM public.unmatched_property_links WHERE id=p_unmatched_id AND company_id=v_company AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pending_link_not_found'; END IF;
 -- Authorize the exact conversation, including owner-only channels. A resolution affects only this occurrence.
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,u.conversation_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=v_company) THEN RAISE EXCEPTION 'invalid_property'; END IF;
 v_linkkey:=public.normalize_property_marketing_link(u.raw_url);
 IF v_linkkey IS NOT NULL THEN
  SELECT id,property_id INTO v_marketing,v_existing FROM public.property_marketing_events WHERE company_id=v_company AND link_key=v_linkkey;
  IF v_existing IS NOT NULL AND v_existing<>p_property_id THEN RAISE EXCEPTION 'link_already_mapped_to_another_property'; END IF;
  IF v_marketing IS NULL THEN
   INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,notes,created_by,auto_sync,sync_status)
   VALUES(v_company,p_property_id,coalesce(public.property_link_provider(u.raw_url),'other'),'publish',u.raw_url,'تم تأكيد الرابط بواسطة موظف',auth.uid(),false,'manual') RETURNING id INTO v_marketing;
  END IF;
 END IF;
 PERFORM public.record_property_link_inquiry_internal(v_company,u.client_id,p_property_id,v_marketing,u.whatsapp_message_id,u.raw_url,u.link_key,u.first_seen_at,true);
 PERFORM public.crm_finalize_property_message(u.whatsapp_message_id);
 UPDATE public.whatsapp_messages SET matched_property_id=p_property_id,matched_marketing_event_id=v_marketing,property_match_status='resolved_manual',property_link_key=u.link_key WHERE id=u.whatsapp_message_id AND company_id=v_company;
 UPDATE public.unmatched_property_links SET status='resolved',property_id=p_property_id,marketing_event_id=v_marketing,resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
 RETURN jsonb_build_object('ok',true,'property_id',p_property_id,'marketing_event_id',v_marketing,'resolved_occurrences',1,'link_key',u.link_key);
END $f$;
REVOKE ALL ON FUNCTION public.resolve_unmatched_property_link(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_unmatched_property_link(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.crm_add_property_marketing_links(p_property_id uuid,p_urls text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE p record; u text; k text; e public.property_marketing_events%rowtype; n int:=0; old int:=0;
BEGIN
 IF public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT id,company_id INTO p FROM public.properties WHERE id=p_property_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found'; END IF;
 IF cardinality(p_urls) IS NULL OR cardinality(p_urls)<1 OR cardinality(p_urls)>50 THEN RAISE EXCEPTION 'one_to_fifty_links_required'; END IF;
 FOREACH u IN ARRAY p_urls LOOP
  u:=trim(u); k:=public.normalize_property_marketing_link(u);
  IF k IS NULL OR k NOT LIKE 'instagram:%' THEN RAISE EXCEPTION 'instagram_post_or_reel_link_required'; END IF;
  SELECT * INTO e FROM public.property_marketing_events WHERE company_id=p.company_id AND link_key=k;
  IF FOUND THEN
   IF e.property_id<>p.id THEN RAISE EXCEPTION 'link_already_mapped_to_another_property'; END IF;
   old:=old+1; CONTINUE;
  END IF;
  INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,created_by,auto_sync,sync_status)
  VALUES(p.company_id,p.id,'instagram','publish',u,auth.uid(),true,'pending'); n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'inserted_count',n,'existing_count',old);
END $f$;
REVOKE ALL ON FUNCTION public.crm_add_property_marketing_links(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_add_property_marketing_links(uuid,text[]) TO authenticated;

ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS property_image_analysis jsonb;
CREATE OR REPLACE FUNCTION public.crm_apply_property_image_evidence(p_message_id uuid,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE m public.whatsapp_messages%rowtype; token text; k text; v_prop uuid; v_event uuid; n int:=0;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound' AND message_type='image';
 IF NOT FOUND THEN RAISE EXCEPTION 'image_message_required'; END IF;
 -- Keep the same client-before-message lock order as the finalizer on retries.
 PERFORM 1 FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF jsonb_typeof(p_evidence)<>'object' THEN RAISE EXCEPTION 'invalid_evidence'; END IF;
 IF coalesce(jsonb_array_length(p_evidence->'urls'),0)+coalesce(jsonb_array_length(p_evidence->'property_codes'),0)>1 THEN
  UPDATE public.whatsapp_messages SET property_image_analysis=p_evidence||jsonb_build_object('status','review_required','reason','تحتوي الصورة أكثر من مرجع ويجب تأكيد العقار المقصود') WHERE id=m.id;
  RETURN jsonb_build_object('ok',true,'matched_count',0,'needs_human_review',true,'reason','multiple_image_references');
 END IF;
 -- Only literal, high confidence identifiers are eligible. Similarity/title/price is never sufficient.
 IF coalesce((p_evidence->>'confidence')::numeric,0)>=0.95 AND coalesce((p_evidence->>'has_literal_reference')::boolean,false) THEN
  FOR token IN SELECT value FROM jsonb_array_elements_text(coalesce(p_evidence->'urls','[]'::jsonb)) LIMIT 5 LOOP
   k:=public.normalize_property_marketing_link(token);
   IF k IS NULL THEN CONTINUE; END IF;
   SELECT id,property_id INTO v_event,v_prop FROM public.property_marketing_events WHERE company_id=m.company_id AND link_key=k;
   IF v_prop IS NOT NULL THEN
    PERFORM public.record_property_link_inquiry_internal(m.company_id,m.client_id,v_prop,v_event,m.id,token,k,coalesce(m.message_timestamp,m.created_at),false); n:=n+1;
   END IF;
  END LOOP;
  FOR token IN SELECT value FROM jsonb_array_elements_text(coalesce(p_evidence->'property_codes','[]'::jsonb)) LIMIT 5 LOOP
   SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO v_prop FROM public.properties
   WHERE company_id=m.company_id AND (lower(property_code)=lower(trim(token)) OR id::text=lower(trim(token)));
   IF v_prop IS NOT NULL THEN
    k:='property-code:'||trim(token);
    PERFORM public.record_property_link_inquiry_internal(m.company_id,m.client_id,v_prop,NULL,m.id,k,k,coalesce(m.message_timestamp,m.created_at),false); n:=n+1;
   END IF;
  END LOOP;
 END IF;
 UPDATE public.whatsapp_messages SET property_image_analysis=p_evidence WHERE id=m.id;
 IF n>0 THEN
  SELECT a.property_id,a.marketing_event_id INTO v_prop,v_event FROM public.property_message_attributions a WHERE a.message_id=m.id ORDER BY a.created_at LIMIT 1;
  UPDATE public.whatsapp_messages SET matched_property_id=v_prop,matched_marketing_event_id=v_event,
   property_match_status=CASE WHEN (SELECT count(*) FROM public.property_message_attributions WHERE message_id=m.id)>1 THEN 'multiple_matched' ELSE 'auto_matched' END WHERE id=m.id;
  UPDATE public.unmatched_property_links SET status='resolved',property_id=v_prop,marketing_event_id=v_event,resolved_at=now(),updated_at=now()
   WHERE whatsapp_message_id=m.id AND link_key='image:'||m.id::text AND status='pending';
  PERFORM public.crm_finalize_property_message(m.id);
 END IF;
 RETURN jsonb_build_object('ok',true,'matched_count',n,'needs_human_review',n=0);
END $f$;
REVOKE ALL ON FUNCTION public.crm_apply_property_image_evidence(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_property_image_evidence(uuid,jsonb) TO service_role;

DROP POLICY IF EXISTS unmatched_property_links_select ON public.unmatched_property_links;
CREATE POLICY unmatched_property_links_select ON public.unmatched_property_links FOR SELECT TO authenticated
 USING(company_id=(SELECT public.my_company()) AND EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.id=unmatched_property_links.whatsapp_message_id AND m.company_id=unmatched_property_links.company_id));
REVOKE UPDATE ON public.unmatched_property_links FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.ignore_unmatched_property_link(p_unmatched_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE u public.unmatched_property_links%rowtype; v_company uuid:=public.my_company();
BEGIN
 IF v_company IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO u FROM public.unmatched_property_links WHERE id=p_unmatched_id AND company_id=v_company AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,u.conversation_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 UPDATE public.unmatched_property_links SET status='ignored',resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
 RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.ignore_unmatched_property_link(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ignore_unmatched_property_link(uuid) TO authenticated;
