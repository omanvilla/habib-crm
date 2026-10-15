-- SQL18 attribution companion. Keep existing exact evidence, locking and RLS contracts.
-- A contact may keep ordinary branch history while receiving separate private investment work.
-- No production row rewrite: these narrow guards affect future attribution writes only.
-- Backup/restore both function definitions in the parent SQL18 migration.

CREATE OR REPLACE FUNCTION public.record_property_link_inquiry_internal(p_company_id uuid, p_client_id uuid, p_property_id uuid, p_marketing_event_id uuid, p_whatsapp_message_id uuid, p_raw_url text, p_link_key text, p_message_at timestamp with time zone, p_manual boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_attr public.property_message_attributions%rowtype; v_inq public.property_inquiries%rowtype;
 v_request uuid; v_assigned uuid; v_source text; v_private boolean:=false; v_client_route text; v_message public.whatsapp_messages%rowtype; v_property public.properties%rowtype; v_at timestamptz:=coalesce(p_message_at,now());
BEGIN
 -- Serialize messages from one client without assuming their other requests match this property.
 SELECT assigned_to,lead_route INTO v_assigned,v_client_route FROM public.clients WHERE id=p_client_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id AND direction='inbound')
 THEN RAISE EXCEPTION 'invalid_attribution_relationship'; END IF;
 SELECT * INTO v_message FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id;
 v_private:=coalesce(v_client_route='investment',false) OR EXISTS(
  SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=v_message.conversation_id AND w.company_id=p_company_id AND w.route_key='investment');
 IF v_private THEN v_assigned:=crm_repair_private.investment_owner(p_company_id);END IF;
 IF p_marketing_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id AND property_id=p_property_id)
 THEN RAISE EXCEPTION 'invalid_marketing_relationship'; END IF;
 SELECT * INTO v_attr FROM public.property_message_attributions WHERE company_id=p_company_id AND message_id=p_whatsapp_message_id AND property_id=p_property_id;
 IF FOUND THEN RETURN v_attr.inquiry_id; END IF;
 SELECT r.id INTO v_request FROM public.client_requests r WHERE company_id=p_company_id AND client_id=p_client_id AND subject_property_id=p_property_id AND status='active'
 AND v_private=(coalesce(r.route_key='investment',false) OR coalesce(r.branch_key='investment',false)) ORDER BY created_at LIMIT 1;
 -- A private message must acquire a private request before creating/updating any inquiry.
 -- In particular, never re-use the ordinary branch's property inquiry for a shared phone.
 IF v_private AND v_request IS NULL THEN
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id AND company_id=p_company_id;
  INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
   assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
  VALUES(p_company_id,p_client_id,'investor',v_property.type,CASE WHEN v_property.type IS NULL THEN '{}'::text[] ELSE ARRAY[v_property.type] END,
   v_property.area,ARRAY[v_property.area],p_property_id,v_assigned,'investment','investment',v_message.recipient_wa_id,
   'whatsapp','استفسار استثماري عن عقار محدد عبر واتساب','whatsapp',v_message.id,true,
   'مراجعة الاستفسار الاستثماري وتأكيد الميزانية والتوقيت','تم تحديد العقار من دليل الرسالة؛ لا تعتبر بيانات الإعلان متطلبات صرح بها العميل') RETURNING id INTO v_request;
 END IF;
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
    NOT EXISTS(SELECT 1 FROM public.property_inquiries pi WHERE pi.company_id=p_company_id AND pi.client_id=p_client_id AND pi.has_inbound_inquiry
     AND v_private=(coalesce(v_client_route='investment',false)
       OR EXISTS(SELECT 1 FROM public.client_requests r WHERE r.id=pi.request_id AND r.company_id=pi.company_id AND (r.route_key='investment' OR r.branch_key='investment'))
       OR EXISTS(SELECT 1 FROM public.whatsapp_messages sm JOIN public.whatsapp_conversations sw ON sw.id=sm.conversation_id AND sw.company_id=sm.company_id
          WHERE sm.id=pi.source_whatsapp_message_id AND sm.company_id=pi.company_id AND sw.route_key='investment')))
   ,false,true,p_marketing_event_id,p_raw_url,p_whatsapp_message_id)
   RETURNING * INTO v_inq;
 END IF;
 INSERT INTO public.property_message_attributions(company_id,message_id,client_id,property_id,marketing_event_id,inquiry_id,request_id,evidence_key,source_url,method)
 VALUES(p_company_id,p_whatsapp_message_id,p_client_id,p_property_id,p_marketing_event_id,v_inq.id,v_request,p_link_key,p_raw_url,
 CASE WHEN p_manual THEN 'manual' WHEN p_link_key LIKE 'property-code:%' THEN 'exact_code' WHEN p_link_key LIKE 'ai-property:%' THEN 'ai_verified' ELSE 'exact_link' END);
 RETURN v_inq.id;
END $function$;

CREATE OR REPLACE FUNCTION public.crm_finalize_property_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.whatsapp_messages%rowtype; a public.property_message_attributions%rowtype;
 p public.properties%rowtype; c public.clients%rowtype; v_req uuid; v_reqcount int; v_propcount int; v_inq uuid; v_n int:=0; v_type text; v_private boolean:=false; v_assigned uuid;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION 'inbound_message_required'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_message_client'; END IF;
 v_private:=coalesce(c.lead_route='investment',false) OR EXISTS(
  SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=m.conversation_id AND w.company_id=m.company_id AND w.route_key='investment');
 v_assigned:=CASE WHEN v_private THEN crm_repair_private.investment_owner(m.company_id) ELSE c.assigned_to END;
 SELECT count(*) INTO v_propcount FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id;
 FOR a IN SELECT * FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id ORDER BY property_id LOOP
  IF a.request_id IS NOT NULL THEN
   IF v_private THEN
    IF NOT EXISTS(SELECT 1 FROM public.client_requests r WHERE r.id=a.request_id AND r.company_id=m.company_id AND r.client_id=m.client_id
      AND (r.route_key='investment' OR r.branch_key='investment')) THEN RAISE EXCEPTION 'investment_attribution_request_mismatch';END IF;
    INSERT INTO public.whatsapp_message_requests(company_id,message_id,request_id,relation)
    VALUES(m.company_id,m.id,a.request_id,'mentioned') ON CONFLICT(message_id,request_id) DO NOTHING;
   END IF;
   CONTINUE;
  END IF;
  SELECT * INTO p FROM public.properties WHERE id=a.property_id AND company_id=m.company_id;
  SELECT id INTO v_req FROM public.client_requests WHERE company_id=m.company_id AND client_id=m.client_id AND subject_property_id=p.id AND status='active'
    AND v_private=(coalesce(route_key='investment',false) OR coalesce(branch_key='investment',false)) ORDER BY created_at LIMIT 1;
  IF v_req IS NULL AND v_propcount=1 THEN
   SELECT count(*),(array_agg(r.id))[1] INTO v_reqcount,v_req FROM public.client_requests r JOIN public.whatsapp_message_requests w ON w.request_id=r.id
   WHERE w.message_id=m.id AND w.company_id=m.company_id AND r.client_id=m.client_id AND r.company_id=m.company_id AND r.status='active'
    AND r.request_type IN ('buyer','tenant','investor') AND (r.subject_property_id IS NULL OR r.subject_property_id=p.id)
    AND v_private=(coalesce(r.route_key='investment',false) OR coalesce(r.branch_key='investment',false));
   IF v_reqcount<>1 THEN v_req:=NULL; END IF;
  END IF;
  IF v_req IS NULL THEN
   -- Do not infer financing, budget, readiness or bedrooms from a listing's price/specification.
   v_type:=CASE WHEN v_private THEN 'investor' WHEN coalesce(m.body,'') ~ '(استئجار|للايجار|للإيجار|rent)' THEN 'tenant' ELSE 'buyer' END;
   INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
    assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
   VALUES(m.company_id,m.client_id,v_type,p.type,CASE WHEN p.type IS NULL THEN '{}'::text[] ELSE ARRAY[p.type] END,p.area,ARRAY[p.area],p.id,
    v_assigned,CASE WHEN v_private THEN 'investment' ELSE coalesce(p.branch_key,c.lead_route,'general') END,
    CASE WHEN v_private THEN 'investment' ELSE coalesce(p.branch_key,c.lead_route,'general') END,m.recipient_wa_id,
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
END $function$;
