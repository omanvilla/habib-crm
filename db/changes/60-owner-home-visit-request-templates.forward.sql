-- SQL60 (5 Nov 2026, owner's decisions):
-- 1) A visit found in a chat no longer fails when the client has several open requests.
-- 2) crm_owner_home feeds the new owner home page. Owner only, read only.
-- 3) Visit follow-ups 2 to 4 use the new service wording once Meta approves it as UTILITY.

-- 1) The manual form still asks which request; automatic visits take the closest one.
CREATE OR REPLACE FUNCTION crm_repair_private.pick_viewing_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_investment boolean;
BEGIN
  IF new.request_id IS NOT NULL OR new.created_via NOT IN ('whatsapp_ai','system') THEN RETURN new; END IF;
  SELECT coalesce(c.lead_route = 'investment', false) INTO v_investment FROM public.clients c WHERE c.id = new.client_id;
  SELECT r.id INTO new.request_id
    FROM public.client_requests r
   WHERE r.client_id = new.client_id AND r.company_id = new.company_id AND r.status = 'active'
     AND (coalesce(r.route_key, '') = 'investment' OR coalesce(r.branch_key, '') = 'investment') = coalesce(v_investment, false)
   ORDER BY (r.subject_property_id = new.property_id) DESC NULLS LAST,
            EXISTS (SELECT 1 FROM public.property_inquiries i WHERE i.request_id = r.id AND i.property_id = new.property_id) DESC,
            r.created_at DESC
   LIMIT 1;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.pick_viewing_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_pick_viewing_request ON public.viewings;
CREATE TRIGGER crm_pick_viewing_request BEFORE INSERT ON public.viewings
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.pick_viewing_request();

-- 2) Owner home. Counts only, no money figures: the reports page stays the reference for those.
CREATE OR REPLACE FUNCTION public.crm_owner_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_company uuid := public.my_company();
  v_today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  v_week date; v_month date; v_problems jsonb := '[]'::jsonb; v_n bigint; v_text text;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  v_week := v_today - extract(dow FROM v_today)::int;
  v_month := date_trunc('month', v_today)::date;

  SELECT count(*) INTO v_n FROM public.whatsapp_reply_drafts WHERE company_id = v_company AND status = 'failed' AND created_at > now() - interval '48 hours'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = whatsapp_reply_drafts.conversation_id AND m.direction = 'outbound' AND m.message_timestamp > whatsapp_reply_drafts.created_at);
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'ردود فشلت خلال يومين', 'count', v_n, 'nav', 'replies'); END IF;

  SELECT count(*), string_agg(DISTINCT j.jobname, ' · ') INTO v_n, v_text FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.active AND d.status = 'failed' AND d.start_time > now() - interval '24 hours';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'مهام مجدولة فشلت اليوم', 'count', v_n, 'detail', v_text); END IF;

  SELECT string_agg(DISTINCT s.last_error_code, ' · ') INTO v_text FROM public.instagram_discovery_state s WHERE s.company_id = v_company AND s.last_error_code IS NOT NULL;
  IF v_text IS NOT NULL THEN v_problems := v_problems || jsonb_build_object('title', 'مزامنة إنستغرام متوقفة', 'detail', v_text); END IF;

  SELECT count(*) INTO v_n FROM public.instagram_accounts a WHERE a.company_id = v_company AND a.connection_status = 'connected' AND a.token_expires_at < now() + interval '14 days';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'ربط إنستغرام ينتهي خلال أسبوعين', 'count', v_n); END IF;

  SELECT count(*) INTO v_n FROM public.whatsapp_visit_followups f WHERE f.company_id = v_company AND f.status = 'failed' AND f.updated_at > now() - interval '7 days';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'متابعات زيارات ما انرسلت', 'count', v_n, 'nav', 'replies'); END IF;

  SELECT count(*) INTO v_n FROM public.whatsapp_outreach_queue q WHERE q.company_id = v_company AND q.status = 'failed' AND q.created_at > now() - interval '7 days';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'رسائل متابعة طلبات ما انرسلت', 'count', v_n, 'nav', 'replies'); END IF;

  SELECT count(*), string_agg(DISTINCT t.template_name, ' · ') INTO v_n, v_text FROM public.whatsapp_template_registry t WHERE t.company_id = v_company AND upper(t.status) IN ('REJECTED','ERROR');
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'قوالب واتساب مرفوضة', 'count', v_n, 'detail', v_text); END IF;

  SELECT count(*) INTO v_n FROM public.deals d WHERE d.company_id = v_company AND d.stage = 'viewing_scheduled' AND d.updated_at < now() - interval '30 days';
  IF v_n > 0 THEN v_problems := v_problems || jsonb_build_object('title', 'صفقات واقفة على زيارة مجدولة من أكثر من شهر', 'count', v_n, 'nav', 'deals'); END IF;

  SELECT n.title, 1 INTO v_text, v_n FROM public.notifications n WHERE n.user_id = auth.uid() AND n.type = 'system_alert' AND NOT coalesce(n.is_read, false) AND n.created_at > now() - interval '3 days'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_reply_drafts r WHERE r.company_id = v_company AND r.status IN ('sent','pending') AND r.created_at > n.created_at) ORDER BY n.created_at DESC LIMIT 1;
  IF v_text IS NOT NULL THEN v_problems := v_problems || jsonb_build_object('title', v_text); END IF;

  RETURN jsonb_build_object(
    'today', v_today,
    'auto_visits', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND v.created_via = 'whatsapp_ai'),
    'overdue_total', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed','postponed') AND v.viewing_date < v_today),
    'overdue', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property
          FROM public.viewings v LEFT JOIN public.clients c ON c.id = v.client_id LEFT JOIN public.properties p ON p.id = v.property_id
         WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed','postponed') AND v.viewing_date < v_today
         ORDER BY v.viewing_date DESC, v.viewing_time DESC NULLS LAST LIMIT 60) x), '[]'::jsonb),
    'upcoming', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT v.id, v.viewing_date, v.viewing_time, c.name AS client, p.title AS property
          FROM public.viewings v LEFT JOIN public.clients c ON c.id = v.client_id LEFT JOIN public.properties p ON p.id = v.property_id
         WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed') AND v.viewing_date BETWEEN v_today AND v_today + 7
         ORDER BY v.viewing_date, v.viewing_time NULLS LAST LIMIT 20) x), '[]'::jsonb),
    'owner_leads_new', (SELECT count(*) FROM public.owner_leads l WHERE l.company_id = v_company AND l.status = 'open' AND l.created_at > now() - interval '7 days'),
    'problems', v_problems,
    'properties', jsonb_build_object(
      'branches', coalesce((SELECT jsonb_agg(x ORDER BY x.branch) FROM (
          SELECT p.branch_key AS branch, count(*) FILTER (WHERE p.status = 'available') AS available, count(*) FILTER (WHERE p.status = 'reserved') AS reserved
            FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.branch_key IN ('barka','muscat') GROUP BY 1) x), '[]'::jsonb),
      'added_week', (SELECT count(*) FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date >= v_week),
      'unchecked', (SELECT count(*) FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.status = 'available' AND (p.availability_checked_at IS NULL OR p.availability_checked_at < now() - interval '30 days')),
      'no_video', coalesce((SELECT jsonb_agg(p.title ORDER BY p.created_at) FROM public.properties p
         WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.status = 'available' AND p.created_at < now() - interval '7 days'
           AND NOT EXISTS (SELECT 1 FROM public.property_marketing_events e WHERE e.property_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM public.instagram_media_catalog m WHERE m.property_id = p.id AND m.state = 'linked')), '[]'::jsonb)),
    'report', jsonb_build_object(
      'week_start', v_week,
      'new_clients', (SELECT count(*) FROM public.clients c WHERE c.company_id = v_company AND coalesce(c.archived, false) = false AND (c.created_at AT TIME ZONE 'Asia/Muscat')::date >= v_week),
      'agent_replies', (SELECT count(*) FROM public.whatsapp_reply_drafts d WHERE d.company_id = v_company AND d.status = 'sent' AND (d.sent_at AT TIME ZONE 'Asia/Muscat')::date >= v_week),
      'visits_done', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status = 'done' AND v.viewing_date >= v_week AND v.viewing_date <= v_today),
      'bookings_month', (SELECT count(*) FROM public.deals d WHERE d.company_id = v_company AND d.reservation_cancelled_at IS NULL AND (d.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date >= v_month),
      'sales_month', (SELECT count(*) FROM public.deals d WHERE d.company_id = v_company AND d.stage IN ('closed','commission_collected') AND (d.closed_at AT TIME ZONE 'Asia/Muscat')::date >= v_month)
    ));
END
$function$;
REVOKE ALL ON FUNCTION public.crm_owner_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_owner_home() TO authenticated;

-- 3) Follow-up wording. Version 1 stays in use until Meta approves version 2 as UTILITY for that number.
CREATE OR REPLACE FUNCTION public.crm_visit_followup_template(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.whatsapp_template_registry t
      WHERE t.route_key = p_route AND t.template_name = 'visit_followup_' || p_step || '_ar_v2'
        AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY')
    THEN 'visit_followup_' || p_step || '_ar_v2' ELSE 'visit_followup_' || p_step || '_ar_v1' END
$function$;
CREATE OR REPLACE FUNCTION public.crm_visit_followup_text(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.crm_visit_followup_template(p_step, p_route) LIKE '%_v1' THEN public.crm_visit_followup_text(p_step)
    WHEN p_step = 2 THEN 'بخصوص زيارتك الاخيرة للعقار هل عندك ملاحظة عليه ؟'
    WHEN p_step = 3 THEN 'بخصوص زيارتك الاخيرة للعقار هل وصلت لقرار ؟'
    WHEN p_step = 4 THEN 'نراجع طلبك المسجل عندنا هل طلبك لين الحين قائم ؟'
    ELSE public.crm_visit_followup_text(p_step) END
$function$;
REVOKE ALL ON FUNCTION public.crm_visit_followup_template(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_visit_followup_text(integer, text) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure);
  n := replace(d, $q$public.crm_visit_followup_text(v_total + 1), 'visit_followup_' || (v_total + 1) || '_ar_v1'$q$,
                  $q$public.crm_visit_followup_text(v_total + 1, c.route_key), public.crm_visit_followup_template(v_total + 1, c.route_key)$q$);
  IF n = d THEN RAISE EXCEPTION 'followup_queue_text_not_found'; END IF;
  EXECUTE n;
END
$do$;
