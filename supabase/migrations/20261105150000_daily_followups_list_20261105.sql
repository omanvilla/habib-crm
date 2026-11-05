-- SQL64 (5 Nov 2026, owner's decision): a daily follow-up list. He opens each chat from the CRM on the branch phone and
-- sends the prepared text, which is free. A message he sends takes the client off the list by itself.
-- Whatever he has not sent by 10am the next day goes out automatically, if a UTILITY template exists for it.
ALTER TABLE public.whatsapp_visit_followups ADD COLUMN IF NOT EXISTS owner_text text;
ALTER TABLE public.whatsapp_outreach_queue ADD COLUMN IF NOT EXISTS owner_text text;
ALTER TABLE public.whatsapp_visit_followups DROP CONSTRAINT IF EXISTS whatsapp_visit_followups_send_mode_check;
ALTER TABLE public.whatsapp_visit_followups ADD CONSTRAINT whatsapp_visit_followups_send_mode_check CHECK (send_mode = ANY (ARRAY['service','template','owner']));

CREATE OR REPLACE FUNCTION public.crm_followup_auto_after(p_created timestamptz)
 RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT (((p_created AT TIME ZONE 'Asia/Muscat')::date + 1) + time '10:00') AT TIME ZONE 'Asia/Muscat'
$function$;

-- Owner sees both branches. A branch account sees its own branch only. One line per client: the visit follow-up comes first.
CREATE OR REPLACE FUNCTION public.crm_followups_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner';
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'auto_on', coalesce((SELECT r.visit_followups_auto FROM public.whatsapp_automation_runtime r WHERE r.company_id = v_company), false),
    'items', coalesce((SELECT jsonb_agg(x ORDER BY x.created_at) FROM (
      SELECT DISTINCT ON (i.client_id) i.source, i.id, i.client_id, i.route_key, i.created_at, i.reason, i.text, i.template_name, i.has_chat,
             c.name AS client, coalesce(c.phone_normalized, c.phone) AS phone, i.property,
             public.crm_followup_auto_after(i.created_at) AS auto_after,
             i.has_chat AND EXISTS (SELECT 1 FROM public.whatsapp_template_registry t WHERE t.company_id = v_company AND t.route_key = i.route_key AND t.template_name = i.template_name
                AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY') AS can_auto
        FROM (
          SELECT 'visit' AS source, 1 AS rank, f.id, f.client_id, f.route_key, f.created_at, 'متابعة بعد الزيارة' AS reason,
                 coalesce(f.owner_text, f.body) AS text, f.template_name, f.conversation_id IS NOT NULL AS has_chat, p.title AS property
            FROM public.whatsapp_visit_followups f
            LEFT JOIN public.viewings v ON v.id = f.viewing_id LEFT JOIN public.properties p ON p.id = v.property_id
           WHERE f.company_id = v_company AND f.status = 'awaiting_approval'
          UNION ALL
          SELECT 'request', 2, q.id, q.client_id, q.route_key, q.created_at, 'متابعة طلب',
                 coalesce(q.owner_text, (SELECT string_agg(m.value, ' ') FROM jsonb_array_elements_text(q.messages) m)), q.template_name, q.conversation_id IS NOT NULL, NULL
            FROM public.whatsapp_outreach_queue q
           WHERE q.company_id = v_company AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run
        ) i
        JOIN public.clients c ON c.id = i.client_id
       WHERE v_owner OR crm_repair_private.staff_can_access_branch(v_company, i.route_key)
       ORDER BY i.client_id, i.rank, i.created_at) x), '[]'::jsonb));
END
$function$;
REVOKE ALL ON FUNCTION public.crm_followups_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_followups_today() TO authenticated;

-- A manual tick, for when the phone message did not reach the system.
CREATE OR REPLACE FUNCTION public.crm_followup_mark_sent(p_client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_route text;
BEGIN
  SELECT coalesce((SELECT f.route_key FROM public.whatsapp_visit_followups f WHERE f.client_id = p_client AND f.company_id = v_company AND f.status = 'awaiting_approval' LIMIT 1),
                  (SELECT q.route_key FROM public.whatsapp_outreach_queue q WHERE q.client_id = p_client AND q.company_id = v_company AND q.status = 'pending' AND q.kind = 'request_followup' LIMIT 1)) INTO v_route;
  IF v_route IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  IF public.my_role() IS DISTINCT FROM 'owner' AND NOT crm_repair_private.staff_can_access_branch(v_company, v_route) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM crm_repair_private.followups_sent_by_person(p_client, now());
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.followups_sent_by_person(p_client uuid, p_at timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.whatsapp_visit_followups SET status = 'sent', send_mode = 'owner', sent_at = p_at, decided_at = now(), error = NULL, updated_at = now()
   WHERE client_id = p_client AND status = 'awaiting_approval' AND created_at <= p_at;
  UPDATE public.whatsapp_outreach_queue SET status = 'sent', sent_at = p_at, reason = 'owner_sent', error = NULL
   WHERE client_id = p_client AND status = 'pending' AND kind = 'request_followup' AND NOT dry_run AND created_at <= p_at;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followups_sent_by_person(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_followup_mark_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_followup_mark_sent(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.followups_on_person_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF new.client_id IS NOT NULL THEN
    PERFORM crm_repair_private.followups_sent_by_person(new.client_id, coalesce(new.message_timestamp, now()));
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followups_on_person_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_followups_on_person_message ON public.whatsapp_messages;
CREATE TRIGGER crm_followups_on_person_message AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (new.direction = 'outbound' AND new.actor_type = 'human')
  EXECUTE FUNCTION crm_repair_private.followups_on_person_message();
