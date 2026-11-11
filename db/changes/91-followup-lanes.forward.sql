-- SQL91 (12 Nov 2026, Ahmed): «مسقط وحده ومستثمرين وحده»: on the Muscat number, investors and project askers are a lane of
-- their own, apart from people asking about properties in Muscat (both still go out from the Muscat number). Each daily
-- follow-up gets `lane` (barka / muscat / investor). It also gets `sends_text`: what really reaches the client. Outside
-- the 24-hour window a follow-up goes as its Meta template («بخصوص طلبك … لين الحين تبحث ؟», or the fixed visit text),
-- not the free text the review wrote; NULL when it cannot go at all (no template: Ahmed answers in the chat himself).
-- Everything else in crm_followups_today is unchanged. Rollback: 91-followup-lanes.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_followups_today'::regproc)) <> 'd9f0f7ca93fa33025bbedfe3c0b5a8f7' THEN
    RAISE EXCEPTION 'SQL91 refused: crm_followups_today changed since 12 Nov 2026';
  END IF;
END $$;

-- investor: the client is marked investor, the agent last filed the chat as investor, he is on the مستحقين list, or the
-- follow-up is about a project, the developer, freehold, residency or investment
CREATE OR REPLACE FUNCTION crm_repair_private.followup_lane(p_client uuid, p_conversation uuid, p_route text, p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_route IS DISTINCT FROM 'muscat' THEN coalesce(p_route, 'muscat')
    WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client AND c.is_investor IS TRUE)
      OR EXISTS (SELECT 1 FROM public.whatsapp_conversations w WHERE w.id = p_conversation AND w.last_automation_action ->> 'category' = 'investor')
      OR EXISTS (SELECT 1 FROM public.mustahiq_waitlist m WHERE m.client_id = p_client)
      OR coalesce(p_text, '') ~ '(مدينة السلطان هيثم|مدينة سلطان هيثم|مشروع|المشاريع|المطور|الأهلي صبور|الاهلي صبور|تملك حر|التملك الحر|إقامة|اقامة|استثمار|الآيكونيك|الايكونيك|وادي زها|عايدة|عايده|اليزن|المستحقين|دفعة مقدمة)'
    THEN 'investor' ELSE 'muscat' END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_lane(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

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
             CASE WHEN v_owner THEN i.owner_instruction END AS owner_instruction, CASE WHEN v_owner THEN i.instructed_at END AS instructed_at,
             crm_repair_private.followup_lane(i.client_id, i.conversation_id, i.route_key, concat_ws(' ', i.reason, i.text, i.property, i.tpl_text)) AS lane,
             CASE WHEN EXISTS (SELECT 1 FROM public.whatsapp_conversations w WHERE w.id = i.conversation_id AND w.last_inbound_at > now() - interval '23 hours') THEN i.text
                  ELSE i.tpl_text END AS sends_text
        FROM (
          SELECT 'visit' AS source, 1 AS rank, f.id, f.client_id, f.conversation_id, f.route_key, f.created_at, f.reviewed_at, coalesce(f.review_reason, 'متابعة بعد الزيارة') AS reason,
                 coalesce(f.owner_text, f.body) AS text, f.template_name, f.conversation_id IS NOT NULL AS has_chat, p.title AS property, f.auto_ok,
                 f.owner_instruction, f.instructed_at, f.body AS tpl_text
            FROM public.whatsapp_visit_followups f
            LEFT JOIN public.viewings v ON v.id = f.viewing_id LEFT JOIN public.properties p ON p.id = v.property_id
           WHERE f.company_id = v_company AND f.status = 'awaiting_approval' AND f.reviewed_at IS NOT NULL
          UNION ALL
          SELECT 'request', 2, q.id, q.client_id, q.conversation_id, q.route_key, q.created_at, q.reviewed_at, coalesce(q.review_reason, 'متابعة طلب'),
                 coalesce(q.owner_text, (SELECT string_agg(m.value, ' ') FROM jsonb_array_elements_text(q.messages) m)), q.template_name, q.conversation_id IS NOT NULL, NULL, q.auto_ok,
                 q.owner_instruction, q.instructed_at,
                 CASE WHEN q.template_name = 'request_followup_ar_v2' THEN 'بخصوص طلبك ' || coalesce(q.template_params ->> 0, '') || E'\nلين الحين تبحث ؟'
                      WHEN q.template_name IS NULL THEN NULL
                      ELSE (SELECT string_agg(m.value, E'\n') FROM jsonb_array_elements_text(q.messages) m) END
            FROM public.whatsapp_outreach_queue q
           WHERE q.company_id = v_company AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run AND q.reviewed_at IS NOT NULL
        ) i
        JOIN public.clients c ON c.id = i.client_id
       WHERE v_owner OR (public.my_role() IN ('manager','agent','viewer') AND i.route_key IS DISTINCT FROM 'owner')
       ORDER BY i.client_id, i.rank, i.created_at) x), '[]'::jsonb));
END
$function$;
