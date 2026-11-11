-- SQL86 (11 Nov 2026, Ahmed): a daily follow-up still offered «فيلا في الصومحان الجنوبية ب٥٧ ألف», written on 8 Nov when the
-- villas were available; they were archived on 10 Nov and the text stayed. Now, when a property leaves the market (status no
-- longer available, or archived), every waiting follow-up of the same branch whose text names its area goes back to review
-- (reviewed_at and owner_text cleared): it leaves the list and the 10am auto-send, and whatsapp-visit-followup-auto writes it
-- again from the current available list on its next run. Follow-ups Ahmed decided himself (queue reason set) are left alone.
-- The one waiting text that names the archived Al Sawmhan villas is sent back now. Rollback: 86-followups-reread-unavailable.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.followups_reread_for_area(p_company uuid, p_branch text, p_area text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_area text := btrim(regexp_replace(coalesce(p_area, ''), '^ال', '')); n1 integer := 0; n2 integer := 0;
BEGIN
  IF length(v_area) < 3 OR p_branch NOT IN ('barka', 'muscat') THEN RETURN 0; END IF;
  UPDATE public.whatsapp_outreach_queue q SET reviewed_at = NULL, owner_text = NULL, review_reason = 'أعيدت للمراجعة: عقار في ' || p_area || ' ما عاد متوفر'
   WHERE q.company_id = p_company AND q.route_key = p_branch AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run
     AND q.reason IS NULL AND q.reviewed_at IS NOT NULL AND position(v_area IN coalesce(q.owner_text, q.messages::text, '')) > 0;
  GET DIAGNOSTICS n1 = ROW_COUNT;
  UPDATE public.whatsapp_visit_followups f SET reviewed_at = NULL, owner_text = NULL, review_reason = 'أعيدت للمراجعة: عقار في ' || p_area || ' ما عاد متوفر', updated_at = now()
   WHERE f.company_id = p_company AND f.route_key = p_branch AND f.status = 'awaiting_approval'
     AND f.reviewed_at IS NOT NULL AND position(v_area IN coalesce(f.owner_text, f.body, '')) > 0;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.followups_reread_on_property_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF (old.status = 'available' AND coalesce(old.archived, false) = false)
     AND (new.status IS DISTINCT FROM 'available' OR coalesce(new.archived, false)) THEN
    BEGIN
      PERFORM crm_repair_private.followups_reread_for_area(new.company_id, new.branch_key, new.area);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SQL86 followups_reread % failed: %', new.id, sqlerrm;
    END;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS crm_followups_reread_on_property_change ON public.properties;
CREATE TRIGGER crm_followups_reread_on_property_change
  AFTER UPDATE OF status, archived ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.followups_reread_on_property_change();

REVOKE ALL ON FUNCTION crm_repair_private.followups_reread_for_area(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_repair_private.followups_reread_on_property_change() FROM PUBLIC, anon, authenticated;

-- now: the waiting follow-up that still offers the archived Al Sawmhan villas (57,000) goes back to review
UPDATE public.whatsapp_outreach_queue SET reviewed_at = NULL, owner_text = NULL, review_reason = 'أعيدت للمراجعة: فلل الصومحان الجنوبية 57 الف ما عادت متوفرة'
 WHERE id = '01a96eee-ae63-40af-b58e-e76c15b6ee04' AND status = 'pending' AND reason IS NULL;

-- each follow-up carries its chat id, so the list can open the chat inside the CRM («فتح في النظام»)
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
