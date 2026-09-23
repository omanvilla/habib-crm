CREATE OR REPLACE FUNCTION public.crm_property_acquisition_funnel(p_property_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
WITH props AS (
 SELECT p.id,p.title,p.property_code,p.branch_key FROM public.properties p
 WHERE p.company_id=(SELECT public.my_company()) AND (p_property_id IS NULL OR p.id=p_property_id) AND NOT coalesce(p.archived,false)
), media AS (
 SELECT DISTINCT ON (e.property_id,coalesce(e.instagram_media_id,e.link_key,e.id::text))
 e.* FROM public.property_marketing_events e JOIN props p ON p.id=e.property_id
 WHERE e.company_id=(SELECT public.my_company()) AND e.channel='instagram'
 ORDER BY e.property_id,coalesce(e.instagram_media_id,e.link_key,e.id::text),e.last_synced_at DESC NULLS LAST,e.created_at DESC
), cohorts AS (
 SELECT DISTINCT i.property_id,i.request_id FROM public.property_inquiries i JOIN props p ON p.id=i.property_id
 JOIN public.client_requests r ON r.id=i.request_id AND r.company_id=i.company_id AND r.client_id=i.client_id
 WHERE i.company_id=(SELECT public.my_company()) AND i.has_inbound_inquiry AND i.request_id IS NOT NULL
), rows AS (
 SELECT p.id,p.title,p.property_code,p.branch_key,
  (SELECT count(*) FROM media m WHERE m.property_id=p.id) media_count,
  (SELECT sum(views) FROM media m WHERE m.property_id=p.id) views,
  (SELECT sum(reach) FROM media m WHERE m.property_id=p.id) reach_non_unique,
  (SELECT sum(total_interactions) FROM media m WHERE m.property_id=p.id) interactions,
  (SELECT max(last_synced_at) FROM media m WHERE m.property_id=p.id) latest_synced_at,
  (SELECT count(*) FROM media m WHERE m.property_id=p.id AND (m.sync_status<>'synced' OR m.views IS NULL)) unavailable_media_count,
  (SELECT count(DISTINCT client_id) FROM public.property_inquiries i WHERE i.property_id=p.id AND i.company_id=public.my_company() AND has_inbound_inquiry) attributed_clients,
  (SELECT count(*) FROM cohorts c WHERE c.property_id=p.id) attributed_requests,
  (SELECT count(*) FROM public.property_inquiries i WHERE i.property_id=p.id AND i.company_id=public.my_company() AND i.has_inbound_inquiry AND i.request_id IS NULL) legacy_inquiries_without_request,
  (SELECT count(DISTINCT client_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company()) whatsapp_attributed_clients,
  (SELECT count(DISTINCT request_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company()) whatsapp_attributed_requests,
  (SELECT count(DISTINCT client_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company() AND a.evidence_key LIKE 'instagram%') instagram_attributed_clients,
  (SELECT count(DISTINCT request_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company() AND a.evidence_key LIKE 'instagram%') instagram_attributed_requests,
  (SELECT count(*) FROM public.viewings v WHERE v.property_id=p.id AND v.company_id=public.my_company() AND NOT coalesce(v.archived,false) AND coalesce(v.status,'') NOT IN ('cancelled','no_show')) booked_visits,
  (SELECT count(*) FROM public.viewings v WHERE v.property_id=p.id AND v.company_id=public.my_company() AND NOT coalesce(v.archived,false) AND v.status IN ('done','completed') AND coalesce(v.attendance,'') NOT IN ('no_show','absent')) completed_visits,
  (SELECT count(*) FROM public.deals d WHERE d.property_id=p.id AND d.company_id=public.my_company() AND d.stage IN ('closed','commission_collected')) closed_deals,
  (SELECT count(*) FROM public.unmatched_property_links u WHERE u.company_id=public.my_company() AND u.status='pending' AND u.property_id=p.id) unresolved_count,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'url',m.url,'media_id',m.instagram_media_id,'views',m.views,'reach',m.reach,'total_interactions',m.total_interactions,'sync_status',m.sync_status,'last_synced_at',m.last_synced_at) ORDER BY m.created_at DESC) FROM media m WHERE m.property_id=p.id),'[]'::jsonb) media,
  (SELECT jsonb_build_object(
    'attributed_request_count',count(*),
    'qualified_request_count',count(*) FILTER(WHERE r.qualified_at IS NOT NULL),
    'requests_with_booked_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.viewings v WHERE v.request_id=r.id AND v.property_id=p.id AND v.company_id=r.company_id AND NOT coalesce(v.archived,false) AND coalesce(v.status,'') NOT IN ('cancelled','no_show'))),
    'requests_with_completed_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.viewings v WHERE v.request_id=r.id AND v.property_id=p.id AND v.company_id=r.company_id AND NOT coalesce(v.archived,false) AND v.status IN ('done','completed') AND coalesce(v.attendance,'') NOT IN ('no_show','absent'))),
    'requests_with_closed_deal',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.deals d WHERE d.request_id=r.id AND d.property_id=p.id AND d.company_id=r.company_id AND d.stage IN ('closed','commission_collected'))))
   FROM cohorts c JOIN public.client_requests r ON r.id=c.request_id WHERE c.property_id=p.id) conversion_cohort
 FROM props p
)
SELECT jsonb_build_object('properties',coalesce(jsonb_agg(to_jsonb(rows)-'id'||jsonb_build_object('property_id',id) ORDER BY title),'[]'::jsonb),
 'reach_is_additive',false,'unresolved_total',(SELECT count(*) FROM public.unmatched_property_links WHERE company_id=public.my_company() AND status='pending'),
 'attribution_note','المشاهدات والتفاعل من المنشورات المرتبطة؛ مجموع الوصول ليس عدد أشخاص فريدين. لا تكشف Meta هوية كل مشاهد. الإسناد مؤكد فقط عند وجود رابط أو رمز في رسالة واردة أو تأكيد موظف. مراحل العمل تشمل تاريخ العقار، ولا تمثل التحويل من نفس مجموعة المشاهدين.') FROM rows;
$f$;
REVOKE ALL ON FUNCTION public.crm_property_acquisition_funnel(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_property_acquisition_funnel(uuid) TO authenticated;

-- Public business contact destinations only, never Meta IDs or credentials.
CREATE OR REPLACE FUNCTION public.crm_public_business_routes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE result jsonb; v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('route_key',route_key,'label',label,'whatsapp_number',whatsapp_number) ORDER BY route_key),'[]'::jsonb) INTO result
 FROM public.company_lead_routes WHERE company_id=v_company AND is_active AND nullif(trim(whatsapp_number),'') IS NOT NULL
 AND (v_role IN ('owner','manager') OR NOT coalesce(owner_only_inbox,false));
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION public.crm_public_business_routes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_public_business_routes() TO authenticated;
