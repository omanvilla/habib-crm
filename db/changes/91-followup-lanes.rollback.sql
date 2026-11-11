-- Rollback of SQL91: crm_followups_today as it was on 12 Nov 2026 (md5 d9f0f7ca93fa33025bbedfe3c0b5a8f7), and the lane helper dropped.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_followups_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner';
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'auto_on', coalesce((SELECT r.visit_followups_auto FROM public.whatsapp_automation_runtime r WHERE r.company_id = v_company), false),
    'waiting_review', (SELECT count(*) FROM public.whatsapp_visit_followups f WHERE f.company_id = v_company AND f.status = 'awaiting_approval' AND f.reviewed_at IS NULL)
                    + (SELECT count(*) FROM public.whatsapp_outreach_queue q WHERE q.company_id = v_company AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run AND q.reviewed_at IS NULL),
    'items', coalesce((SELECT jsonb_agg(x ORDER BY x.created_at) FROM (
      SELECT DISTINCT ON (i.client_id) i.source, i.id, i.client_id, i.conversation_id, i.route_key, i.created_at, i.reason, i.text, i.template_name, i.has_chat,
             c.name AS client, coalesce(c.phone_normalized, c.phone) AS phone, i.property,
             public.crm_followup_auto_after(i.reviewed_at) AS auto_after,
             i.auto_ok AND i.has_chat AND EXISTS (SELECT 1 FROM public.whatsapp_template_registry t WHERE t.company_id = v_company AND t.route_key = i.route_key AND t.template_name = i.template_name
                AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY') AS can_auto,
             CASE WHEN v_owner THEN i.owner_instruction END AS owner_instruction, CASE WHEN v_owner THEN i.instructed_at END AS instructed_at
        FROM (
          SELECT 'visit' AS source, 1 AS rank, f.id, f.client_id, f.conversation_id, f.route_key, f.created_at, f.reviewed_at, coalesce(f.review_reason, 'متابعة بعد الزيارة') AS reason,
                 coalesce(f.owner_text, f.body) AS text, f.template_name, f.conversation_id IS NOT NULL AS has_chat, p.title AS property, f.auto_ok,
                 f.owner_instruction, f.instructed_at
            FROM public.whatsapp_visit_followups f
            LEFT JOIN public.viewings v ON v.id = f.viewing_id LEFT JOIN public.properties p ON p.id = v.property_id
           WHERE f.company_id = v_company AND f.status = 'awaiting_approval' AND f.reviewed_at IS NOT NULL
          UNION ALL
          SELECT 'request', 2, q.id, q.client_id, q.conversation_id, q.route_key, q.created_at, q.reviewed_at, coalesce(q.review_reason, 'متابعة طلب'),
                 coalesce(q.owner_text, (SELECT string_agg(m.value, ' ') FROM jsonb_array_elements_text(q.messages) m)), q.template_name, q.conversation_id IS NOT NULL, NULL, q.auto_ok,
                 q.owner_instruction, q.instructed_at
            FROM public.whatsapp_outreach_queue q
           WHERE q.company_id = v_company AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run AND q.reviewed_at IS NOT NULL
        ) i
        JOIN public.clients c ON c.id = i.client_id
       WHERE v_owner OR (public.my_role() IN ('manager','agent','viewer') AND i.route_key IS DISTINCT FROM 'owner')
       ORDER BY i.client_id, i.rank, i.created_at) x), '[]'::jsonb));
END
$function$;
DROP FUNCTION IF EXISTS crm_repair_private.followup_lane(uuid, uuid, text, text);
