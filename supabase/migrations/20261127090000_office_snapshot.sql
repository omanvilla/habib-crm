-- SQL161 (27 Nov 2026, Ahmed chose «ابنِ مع الإصلاحين» for the «المكتب» screen).
-- crm_office_snapshot(): one read for the page «المكتب».
--   * workers (owner / manager only): every automatic «employee» (the reply agent, the reply audit, pricing, follow-ups,
--     outreach, …) with its last run, what it did, and a colour. A cron «succeeded» only means the request was queued,
--     so the colour also looks at the job's own output table where there is one.
--   * staff: the owner sees every active agent / manager, an agent sees only herself. Per person: calls this month
--     against the call target (crm_repair_private.call_month), tasks done / overdue, WhatsApp replies on the lines she is
--     assigned to (company_lead_routes.assigned_to; the Business app does not say WHO typed a reply, only on which line),
--     her median reply time in working hours, and the branch goals of crm_branch_target_snapshot() for her branches
--     (visits this week, new properties this week, bookings this month). No money of any kind leaves this function.
-- The two «fixes» proposed with the mock-up turned out not to be needed: goals are per BRANCH since SQL31/SQL138 and a
-- month without a row uses the defaults (so November has goals), and visits are already counted by the property's
-- branch, which is how this function attributes them too. Nothing in existing data is changed.
-- Rollback: 161-office-snapshot.rollback.sql
CREATE OR REPLACE FUNCTION public.crm_office_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  c uuid := public.my_company(); u uuid := auth.uid(); r text := coalesce(public.my_role(), '');
  today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  m0 date; m1 date; snap jsonb; workers jsonb := '[]'::jsonb; staff jsonb; waiting int;
BEGIN
  IF c IS NULL OR u IS NULL OR r NOT IN ('owner', 'manager', 'agent')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = u AND company_id = c AND is_active) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  m0 := date_trunc('month', today)::date; m1 := (m0 + interval '1 month')::date - 1;
  snap := public.crm_branch_target_snapshot();

  -- ---------------- staff ----------------
  WITH people AS (
    SELECT p.id, p.full_name, p.last_login_at,
      coalesce((SELECT array_agg(rt.route_key ORDER BY rt.route_key) FROM public.company_lead_routes rt
                 WHERE rt.company_id = c AND rt.assigned_to = p.id AND rt.is_active AND rt.owner_only_inbox IS FALSE
                   AND rt.route_key IN ('barka', 'muscat')), '{}') routes
    FROM public.profiles p
    WHERE p.company_id = c AND p.is_active AND p.role IN ('agent', 'manager')
      AND (r IN ('owner', 'manager') OR p.id = u)
  ), msgs AS (
    -- customer messages and human replies only (the agent's automatic replies are left out), last 30 days
    SELECT cv.route_key, m.conversation_id, m.direction, coalesce(m.message_timestamp, m.created_at) ts
    FROM public.whatsapp_messages m JOIN public.whatsapp_conversations cv ON cv.id = m.conversation_id AND cv.company_id = m.company_id
    WHERE m.company_id = c AND m.created_at > now() - interval '30 days' AND cv.route_key IN ('barka', 'muscat')
      AND (m.direction = 'inbound' OR (m.direction = 'outbound' AND m.actor_type = 'human'))
  ), runs AS (
    SELECT *, count(*) FILTER (WHERE direction = 'outbound') OVER (PARTITION BY conversation_id ORDER BY ts ROWS UNBOUNDED PRECEDING) grp
    FROM msgs
  ), waits AS (
    SELECT route_key, conversation_id, grp, min(ts) first_in FROM runs WHERE direction = 'inbound' GROUP BY 1, 2, 3
  ), replies AS (
    SELECT conversation_id, grp - 1 g, ts FROM runs WHERE direction = 'outbound'
  ), speed AS (
    -- a message that came in during working hours (7 AM to 10 PM Muscat) to the next human reply
    SELECT w.route_key, extract(epoch FROM rp.ts - w.first_in) / 60 mins
    FROM waits w JOIN replies rp ON rp.conversation_id = w.conversation_id AND rp.g = w.grp
    WHERE extract(hour FROM w.first_in AT TIME ZONE 'Asia/Muscat') BETWEEN 7 AND 21
  ), branch_goal AS (
    SELECT b ->> 'branch' branch, b FROM jsonb_array_elements(snap -> 'branches') b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'name', pp.full_name, 'last_login_at', pp.last_login_at, 'branches', to_jsonb(pp.routes),
      'calls', crm_repair_private.call_month(c, pp.id, m0, m1),
      'tasks_done_30d', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND t.done AND t.completed_at > now() - interval '30 days'),
      'tasks_overdue', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND NOT coalesce(t.done, false) AND t.due_date < today),
      'tasks_today', (SELECT count(*) FROM public.tasks t WHERE t.company_id = c AND t.user_id = pp.id AND NOT coalesce(t.done, false) AND t.due_date = today),
      'wa_replies_30d', (SELECT count(*) FROM msgs x WHERE x.direction = 'outbound' AND x.route_key = ANY (pp.routes)),
      'wa_clients_30d', (SELECT count(DISTINCT x.conversation_id) FROM msgs x WHERE x.direction = 'outbound' AND x.route_key = ANY (pp.routes)),
      'reply_minutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.mins))::numeric) FROM speed s WHERE s.route_key = ANY (pp.routes)),
      'visits_week', (SELECT coalesce(sum((g.b ->> 'viewings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'visits_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'viewings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'new_properties_week', (SELECT coalesce(sum((g.b ->> 'new_properties')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'new_properties_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'new_properties')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'bookings_month', (SELECT coalesce(sum((g.b ->> 'bookings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes)),
      'bookings_goal', (SELECT coalesce(sum((g.b -> 'goals' ->> 'bookings')::int), 0) FROM branch_goal g WHERE g.branch = ANY (pp.routes))
    ) ORDER BY pp.full_name), '[]'::jsonb)
  INTO staff FROM people pp;

  -- conversations whose last message is the customer's and nobody (agent or human) answered, last 3 days
  SELECT count(*) INTO waiting FROM public.whatsapp_conversations cv
  WHERE cv.company_id = c AND cv.route_key IN ('barka', 'muscat')
    AND (r IN ('owner', 'manager') OR crm_repair_private.staff_is_branch_member(c, cv.route_key))
    AND cv.last_inbound_at > now() - interval '3 days' AND cv.last_inbound_at > coalesce(cv.last_outbound_at, '-infinity')
    AND (cv.ignored_at IS NULL OR cv.ignored_at < cv.last_inbound_at)
    AND (cv.waiting_done_at IS NULL OR cv.waiting_done_at < cv.last_inbound_at);

  -- ---------------- automatic workers (owner / manager only) ----------------
  IF r IN ('owner', 'manager') THEN
    WITH def(ord, key, name, icon, jobs, max_age) AS (VALUES
      (1, 'brain', 'العقل (يرد في واتساب)', '💬', ARRAY['crm-retry-failed-agent-sends'], interval '6 hours'),
      (2, 'audit', 'فاحص الردود', '🧐', ARRAY['reply_audit_morning', 'reply_audit_afternoon'], interval '30 hours'),
      (3, 'coach', 'مدرب الردود (أسبوعي)', '🎓', ARRAY['reply_coach_weekly'], interval '8 days'),
      (4, 'pricing', 'المسعّر', '🏷️', ARRAY['owner_price_study_tick', 'owner_price_study_unpriced', 'owner_price_study_held', 'owner_price_study_drive', 'owner_price_study_open_tasks'], interval '2 hours'),
      (5, 'followups', 'متابعة بعد الزيارة', '📅', ARRAY['habib_visit_followups_queue', 'habib_visit_followups_auto_send'], interval '2 hours'),
      (6, 'outreach', 'رسائل العملاء القدامى', '📣', ARRAY['outreach_queue_requests', 'outreach_send_approved', 'outreach_seed_requests_daily', 'outreach_auto_sold_notice'], interval '2 hours'),
      (7, 'matcher', 'مطابقة عروض الملاك', '🏠', ARRAY['owner_leads_match_daily'], interval '30 hours'),
      (8, 'alerts', 'تنبيهات العقارات', '🔔', ARRAY['crm_property_alerts_run', 'crm_expire_listing_agreements_daily', 'agreement_ending_whatsapp'], interval '30 hours'),
      (9, 'voice', 'مفرّغ الرسائل الصوتية', '🎙️', ARRAY['whatsapp_transcribe_voice_notes'], interval '2 hours'),
      (10, 'instagram', 'متابع إنستغرام', '📸', ARRAY['habib_instagram_media_discovery'], interval '2 hours')
    ), runs AS (
      SELECT d.key, max(l.start_time) last_run,
        count(*) FILTER (WHERE l.status = 'failed') failed,
        count(j.jobid) found
      FROM def d LEFT JOIN cron.job j ON j.jobname = ANY (d.jobs) AND j.active
      LEFT JOIN crm_repair_private.cron_last_runs l ON l.jobid = j.jobid
      GROUP BY d.key
    ), facts AS (
      SELECT 'brain' key,
        (SELECT max(created_at) FROM public.whatsapp_reply_drafts WHERE company_id = c) last_out,
        (SELECT count(*) FROM public.whatsapp_reply_drafts WHERE company_id = c AND (created_at AT TIME ZONE 'Asia/Muscat')::date = today)::text || ' رد اليوم' did
      UNION ALL SELECT 'audit', (SELECT max(created_at) FROM public.whatsapp_reply_audit_runs),
        (SELECT count(*) FROM public.whatsapp_reply_audit_findings f WHERE f.created_at > now() - interval '24 hours')::text || ' ملاحظة آخر يوم'
      UNION ALL SELECT 'coach', (SELECT max(created_at) FROM public.whatsapp_reply_coach_reports), 'تقرير كل سبت'
      UNION ALL SELECT 'pricing', (SELECT max(created_at) FROM public.owner_price_studies WHERE company_id = c),
        (SELECT count(*) FROM public.owner_price_studies WHERE company_id = c AND created_at >= m0)::text || ' دراسة هالشهر'
      UNION ALL SELECT 'followups', (SELECT max(created_at) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_followup'),
        (SELECT count(*) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_followup' AND created_at > now() - interval '7 days')::text || ' رسالة هالأسبوع'
      UNION ALL SELECT 'outreach', (SELECT max(created_at) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_outreach'),
        (SELECT count(*) FROM public.whatsapp_messages WHERE company_id = c AND channel_source = 'crm_outreach' AND created_at > now() - interval '7 days')::text || ' رسالة هالأسبوع'
      UNION ALL SELECT 'matcher', NULL, (SELECT count(*) FROM public.owner_lead_matches)::text || ' مطابقة'
      UNION ALL SELECT 'alerts', NULL, NULL
      UNION ALL SELECT 'voice', NULL, NULL
      UNION ALL SELECT 'instagram', NULL, NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key', d.key, 'name', d.name, 'icon', d.icon, 'last_run', rn.last_run, 'last_output', f.last_out, 'did', f.did,
        'status', CASE
          WHEN rn.found = 0 THEN 'off'
          WHEN rn.failed > 0 THEN 'red'
          WHEN rn.last_run IS NULL OR rn.last_run < now() - d.max_age THEN 'yellow'
          -- the reply agent: a customer message newer than its last draft by more than 20 minutes
          WHEN d.key = 'brain' AND EXISTS (
            SELECT 1 FROM public.whatsapp_messages m JOIN public.whatsapp_conversations cv ON cv.id = m.conversation_id
            WHERE m.company_id = c AND m.direction = 'inbound' AND cv.route_key IN ('barka', 'muscat') AND NOT coalesce(cv.agent_muted, false)
              AND m.created_at > now() - interval '3 hours' AND m.created_at < now() - interval '20 minutes'
              AND m.created_at > coalesce(f.last_out, '-infinity')) THEN 'red'
          ELSE 'green' END
      ) ORDER BY d.ord), '[]'::jsonb)
    INTO workers FROM def d JOIN runs rn ON rn.key = d.key LEFT JOIN facts f ON f.key = d.key;
  END IF;

  RETURN jsonb_build_object('today', today, 'now', now(), 'role', r, 'waiting_conversations', waiting,
    'workers', workers, 'staff', staff,
    'failed_jobs', CASE WHEN r IN ('owner', 'manager') THEN (
      SELECT coalesce(jsonb_agg(j.jobname ORDER BY j.jobname), '[]'::jsonb) FROM cron.job j JOIN crm_repair_private.cron_last_runs l ON l.jobid = j.jobid
      WHERE j.active AND l.status = 'failed') ELSE '[]'::jsonb END);
END $function$;

REVOKE ALL ON FUNCTION public.crm_office_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_office_snapshot() TO authenticated;
