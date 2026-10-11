-- Run in one explicit transaction after the matching forward migration.
-- Set crm.repair_company_id transaction-locally to the reviewed company UUID.
-- Real identifiers/contact data must not be committed to this repository.
-- Only evidence-confirmed, single-inbox-branch WhatsApp contacts with no
-- visit/deal history, manual routing or conflicting request geography qualify.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '40s';
LOCK TABLE public.clients, public.client_requests, public.client_request_assignees,
  public.whatsapp_conversations IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE wa_branch_repair_candidates ON COMMIT DROP AS
WITH origins AS (
 SELECT c.id AS client_id,c.company_id,c.lead_route,c.assigned_to,c.source,c.archived,
   count(DISTINCT w.route_key) AS route_count,min(w.route_key) AS physical_branch
 FROM public.clients c
 JOIN public.whatsapp_conversations w ON w.client_id=c.id AND w.company_id=c.company_id
 WHERE c.company_id=current_setting('crm.repair_company_id')::uuid
 GROUP BY c.id
)
SELECT o.client_id,o.company_id,o.physical_branch,lr.assigned_to
FROM origins o
JOIN public.company_lead_routes lr ON lr.company_id=o.company_id
 AND lr.route_key=o.physical_branch AND lr.is_active=true
JOIN public.profiles p ON p.id=lr.assigned_to AND p.company_id=o.company_id
 AND p.is_active=true AND p.role IN ('owner','manager','agent')
WHERE o.route_count=1 AND o.physical_branch IN ('muscat','barka')
 AND o.lead_route IS DISTINCT FROM o.physical_branch
 AND o.source='whatsapp' AND o.archived IS NOT TRUE
 AND NOT EXISTS(SELECT 1 FROM public.viewings v WHERE v.client_id=o.client_id)
 AND NOT EXISTS(SELECT 1 FROM public.deals d WHERE d.client_id=o.client_id)
 AND NOT EXISTS(
   SELECT 1 FROM public.client_requests r WHERE r.client_id=o.client_id AND (
     r.manual_assigned_to IS NOT NULL OR r.request_type IN ('investor','consultation')
     OR r.subject_property_id IS NOT NULL OR r.created_via IS DISTINCT FROM 'whatsapp'
     OR r.status NOT IN ('active','paused')
     OR (cardinality(public.crm_infer_request_branches(r.route_key,r.branch_key,r.wilayat,r.preferred_area,r.preferred_areas,r.alternative_areas))>0
       AND public.crm_infer_request_branches(r.route_key,r.branch_key,r.wilayat,r.preferred_area,r.preferred_areas,r.alternative_areas)<>ARRAY[o.physical_branch])
     OR (cardinality(public.crm_infer_request_branches(r.route_key,r.branch_key,r.wilayat,r.preferred_area,r.preferred_areas,r.alternative_areas))=0
       AND crm_repair_private.whatsapp_request_physical_branch(r.company_id,r.client_id,r.origin_whatsapp_message_id,r.inbound_number) IS DISTINCT FROM o.physical_branch)
   )
 );

INSERT INTO crm_repair_private.whatsapp_branch_repair_audit(company_id,client_id,change_key,before_data)
SELECT c.company_id,c.id,'whatsapp_branch_fallback_20261011',jsonb_build_object(
 'client',to_jsonb(c),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.client_requests r WHERE r.client_id=c.id),'[]'::jsonb),
 'assignees',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id,a.user_id) FROM public.client_request_assignees a
   JOIN public.client_requests r ON r.id=a.request_id WHERE r.client_id=c.id),'[]'::jsonb)
)
FROM public.clients c JOIN wa_branch_repair_candidates e ON e.client_id=c.id AND e.company_id=c.company_id;

UPDATE public.client_requests r SET route_key=e.physical_branch,branch_key=e.physical_branch,assigned_to=e.assigned_to
FROM wa_branch_repair_candidates e
WHERE r.client_id=e.client_id AND r.company_id=e.company_id
 AND cardinality(public.crm_infer_request_branches(r.route_key,r.branch_key,r.wilayat,r.preferred_area,r.preferred_areas,r.alternative_areas))=0;

UPDATE public.clients c SET lead_route=e.physical_branch,assigned_to=e.assigned_to
FROM wa_branch_repair_candidates e WHERE c.id=e.client_id AND c.company_id=e.company_id
 AND (c.lead_route IS DISTINCT FROM e.physical_branch OR c.assigned_to IS DISTINCT FROM e.assigned_to);

UPDATE crm_repair_private.whatsapp_branch_repair_audit a SET after_data=jsonb_build_object(
 'client',to_jsonb(c),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.client_requests r WHERE r.client_id=c.id),'[]'::jsonb),
 'assignees',coalesce((SELECT jsonb_agg(to_jsonb(ra) ORDER BY ra.request_id,ra.user_id) FROM public.client_request_assignees ra
   JOIN public.client_requests r ON r.id=ra.request_id WHERE r.client_id=c.id),'[]'::jsonb)
)
FROM public.clients c JOIN wa_branch_repair_candidates e ON e.client_id=c.id AND e.company_id=c.company_id
WHERE a.company_id=c.company_id AND a.client_id=c.id AND a.change_key='whatsapp_branch_fallback_20261011';

DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM wa_branch_repair_candidates e JOIN public.clients c ON c.id=e.client_id
   WHERE c.lead_route IS DISTINCT FROM e.physical_branch OR c.assigned_to IS DISTINCT FROM e.assigned_to)
 THEN RAISE EXCEPTION 'WhatsApp branch repair did not converge'; END IF;
 IF EXISTS(
  SELECT 1 FROM crm_repair_private.whatsapp_branch_repair_audit a JOIN wa_branch_repair_candidates e ON e.client_id=a.client_id AND e.company_id=a.company_id,
   LATERAL jsonb_array_elements(a.before_data->'requests') b,
   LATERAL jsonb_array_elements(a.after_data->'requests') n
  WHERE a.change_key='whatsapp_branch_fallback_20261011' AND b->>'id'=n->>'id'
   AND (b-ARRAY['route_key','branch_key','assigned_to','updated_at']) IS DISTINCT FROM (n-ARRAY['route_key','branch_key','assigned_to','updated_at'])
 ) THEN RAISE EXCEPTION 'WhatsApp branch repair changed a request business field'; END IF;
 IF EXISTS(SELECT 1 FROM crm_repair_private.whatsapp_branch_repair_audit a JOIN wa_branch_repair_candidates e ON e.client_id=a.client_id AND e.company_id=a.company_id
   WHERE a.change_key='whatsapp_branch_fallback_20261011'
   AND (a.before_data->'client'->>'created_at' IS DISTINCT FROM a.after_data->'client'->>'created_at'
     OR a.before_data->'client'->>'phone' IS DISTINCT FROM a.after_data->'client'->>'phone'
     OR a.before_data->'client'->>'name' IS DISTINCT FROM a.after_data->'client'->>'name'))
 THEN RAISE EXCEPTION 'WhatsApp branch repair changed client identity or original date'; END IF;
END
$verify$;

SELECT count(*) AS repaired_clients,
 (SELECT count(*) FROM public.client_requests r JOIN wa_branch_repair_candidates e ON e.client_id=r.client_id) AS linked_requests,
 'private before/after snapshots retained' AS audit
FROM wa_branch_repair_candidates;
