-- SQL134 (18 Nov 2026, Ahmed's decision review, docs/مراجعة-القرارات-20261118.md; Ahmed approved the plan: «نعم موافق»).
-- Decision numbers in brackets refer to that file.
--  [51] pricing hours: the 2-hour «not priced» alert counts 05:00–21:00 Muscat (was 07:00–23:00) and is sent 05:00–21:15.
--  [54] a price-study task opened by the 10-minute job is due the same day (was tomorrow), and never for the test number.
--  [52] «متابعة نتيجة الزيارة» closes on a message only when the message comes after the visit's time
--       (the automatic confirmation one hour before the visit no longer closes it).
--  [53] «the property is gone» = sold, reserved, withdrawn or archived, in the handoff/alternative and serious-buyer triggers.
--  [57] «the client who booked» = any stage from deposit on (deposit, awaiting_finance, finance_approved, awaiting_clearance,
--       ownership_transfer, closed, commission_collected) or a confirmed reservation.
--  [8]  «🔥 بديل» and «🔥 مشتري جاد» notifications are copied to active staff (manager, agent) who can open that client's chat,
--       and one «تم» (is_read) clears every copy. Only the owner's row is sent to WhatsApp (no duplicate message to Ahmed).
--  [55] contract (property_archive) and Instagram notifications for the owner also reach his WhatsApp, once each;
--       and a listing agreement that ends within 14 days sends one WhatsApp reminder per property and end date.
--  [20] properties.utilities_note: Ahmed's answer about water/electricity, read by the reply agent.
-- Rollback: 134-review-20261118.rollback.sql
SET LOCAL lock_timeout = '10s';

-- [51] ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_run_minutes(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(extract(epoch from (least(p_to, w.e) - greatest(p_from, w.s))) / 60), 0)::numeric
    from generate_series((p_from at time zone 'Asia/Muscat')::date::timestamp, (p_to at time zone 'Asia/Muscat')::date::timestamp, interval '1 day') d
   cross join lateral (select ((d + time '05:00') at time zone 'Asia/Muscat') as s, ((d + time '21:00') at time zone 'Asia/Muscat') as e) w
   where least(p_to, w.e) > greatest(p_from, w.s)
$function$;

CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()
 RETURNS TABLE(task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text, waited_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.task_id, b.company_id, b.branch, b.property_kind, b.kind_raw, b.area, b.wilayat, m.minutes::integer
    from public.tasks t
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   cross join lateral (select crm_repair_private.price_study_run_minutes(t.created_at, now()) as minutes) m
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and t.created_at >= timestamptz '2026-11-13 00:00:00+04'
     and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)
     and m.minutes >= 120 and m.minutes < 180
     and (now() at time zone 'Asia/Muscat')::time >= time '05:00'
     and (now() at time zone 'Asia/Muscat')::time < time '21:15'
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = t.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason = 'price_study_unpriced:' || t.id::text)
   order by t.created_at
   limit 10
$function$;

-- [54] ---------------------------------------------------------------------------------------------------------------
DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.price_study_open_tasks()'::regprocedure);
BEGIN
  IF position('((now() at time zone ''Asia/Muscat'')::date + 1)' in def) = 0 THEN
    RAISE EXCEPTION 'price_study_open_tasks: due-date text not found';
  END IF;
  def := replace(def, '((now() at time zone ''Asia/Muscat'')::date + 1)', '(now() at time zone ''Asia/Muscat'')::date');
  def := replace(def,
    '       AND o.client_id IS NOT NULL',
    '       AND o.client_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.clients tc, public.whatsapp_automation_runtime rt
                        WHERE tc.id = o.client_id AND rt.company_id = o.company_id
                          AND right(regexp_replace(coalesce(tc.phone_normalized, tc.phone, ''''), ''\D'', '''', ''g''), 8)
                              = ANY (SELECT right(x, 8) FROM unnest(coalesce(rt.allowed_customer_phones, ''{}''::text[])) x))');
  IF position('allowed_customer_phones' in def) = 0 THEN RAISE EXCEPTION 'price_study_open_tasks: test-number text not added'; END IF;
  EXECUTE def;
END $do$;
-- open tasks opened since this morning become due today
UPDATE public.tasks SET due_date = (now() at time zone 'Asia/Muscat')::date
 WHERE title ILIKE 'دراسة سعر%' AND NOT coalesce(done, false) AND owner_lead_id IS NOT NULL
   AND created_at >= timestamptz '2026-11-18 00:00:00+04' AND due_date > (now() at time zone 'Asia/Muscat')::date;

-- [52] ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_client uuid; v_at timestamptz;
BEGIN
  IF NEW.direction <> 'outbound' OR coalesce(NEW.actor_type, '') NOT IN ('human', 'automated')
     OR coalesce(NEW.message_type, '') IN ('reaction', 'edit', 'revoke', 'system', 'unsupported') THEN RETURN NULL; END IF;
  v_client := coalesce(NEW.client_id, (SELECT c.client_id FROM public.whatsapp_conversations c WHERE c.id = NEW.conversation_id));
  IF v_client IS NULL THEN RETURN NULL; END IF;
  v_at := coalesce(NEW.message_timestamp, now());
  -- only a message sent after the visit's own time closes the task (not the confirmation before the visit)
  UPDATE public.tasks t
     SET done = true, completed_at = now(),
         notes = left(concat_ws(E'\n', t.notes, 'انقفلت تلقائياً: '
                   || CASE WHEN NEW.actor_type = 'human' THEN 'انرسلت رسالة للعميل من المكتب بعد الزيارة' ELSE 'العقل راسل العميل بعد الزيارة' END
                   || ' (' || to_char(now() at time zone 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || ')'), 4000)
   WHERE NOT coalesce(t.done, false)
     AND t.company_id = NEW.company_id
     AND t.client_id = v_client
     AND t.title LIKE 'متابعة نتيجة الزيارة%'
     AND t.created_at < v_at
     AND EXISTS (SELECT 1 FROM public.viewings v
                  WHERE v.id = t.viewing_id
                    AND ((v.viewing_date + coalesce(v.viewing_time, time '23:59')) AT TIME ZONE 'Asia/Muscat') <= v_at);
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

-- [53] [57] helpers --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.property_is_gone(p_status text, p_archived boolean)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$ select coalesce(p_status, '') in ('sold', 'reserved', 'withdrawn') or coalesce(p_archived, false) $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.deal_is_booked(p_stage text, p_reservation_confirmed_at timestamptz)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  select p_reservation_confirmed_at is not null
      or coalesce(p_stage, '') in ('deposit', 'awaiting_finance', 'finance_approved', 'awaiting_clearance',
                                   'ownership_transfer', 'closed', 'commission_collected')
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid; n integer; alt text; who text; what text;
BEGIN
  IF crm_repair_private.property_is_gone(new.status, new.archived)
     AND NOT crm_repair_private.property_is_gone(old.status, old.archived) THEN
    what := CASE WHEN new.status = 'sold' THEN 'انباع' WHEN new.status = 'reserved' THEN 'انحجز'
                 WHEN new.status = 'withdrawn' THEN 'انسحب' ELSE 'انأرشف' END;
    alt := crm_repair_private.property_alternative(new.id);
    FOR c IN
      SELECT x.client_id FROM (
        SELECT DISTINCT ON (pi.client_id) pi.client_id, pi.property_id
          FROM public.property_inquiries pi
         WHERE pi.company_id = new.company_id
           AND pi.client_id IN (SELECT client_id FROM public.property_inquiries WHERE property_id = new.id)
         ORDER BY pi.client_id, coalesce(pi.last_inquiry_at, pi.created_at) DESC) x
       WHERE x.property_id = new.id
      UNION
      SELECT d.client_id FROM public.deals d WHERE d.property_id = new.id AND d.client_id IS NOT NULL
    LOOP
      n := crm_repair_private.close_hot_handoffs(new.company_id, c,
        'العقار ' || what || ': ' || coalesce(new.internal_name, new.title, ''));
      IF n > 0 AND alt IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.deals d WHERE d.property_id = new.id AND d.client_id = c
              AND crm_repair_private.deal_is_booked(d.stage, d.reservation_confirmed_at)) THEN
        SELECT CASE WHEN public.crm_is_real_name(cl.name) THEN btrim(cl.name) ELSE coalesce(cl.phone_normalized, cl.phone, 'عميل') END
          INTO who FROM public.clients cl WHERE cl.id = c;
        INSERT INTO public.notifications (user_id, title, body, type, client_id)
        SELECT pr.id, '🔥 بديل: ' || coalesce(who, 'عميل') || ' · ' || coalesce(new.internal_name, new.title, 'العقار') || ' ' || what,
               'اعرض عليه بديل: ' || alt, 'whatsapp_handoff', c
          FROM public.profiles pr
         WHERE pr.company_id = new.company_id AND pr.role = 'owner' AND coalesce(pr.is_active, false);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.hot_buyer_property_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF crm_repair_private.property_is_gone(NEW.status, NEW.archived)
     AND NOT crm_repair_private.property_is_gone(OLD.status, OLD.archived) THEN
    UPDATE public.notifications n SET is_read = true
     WHERE n.type = 'whatsapp_handoff' AND NOT coalesce(n.is_read, false)
       AND coalesce(n.title, '') ~ '^🔥 مشتري جاد'
       AND n.client_id IN (
         SELECT v.client_id FROM public.viewings v WHERE v.property_id = NEW.id AND v.client_id IS NOT NULL
         UNION
         SELECT x.client_id FROM (
           SELECT DISTINCT ON (pi.client_id) pi.client_id, pi.property_id FROM public.property_inquiries pi
            WHERE pi.company_id = NEW.company_id AND pi.client_id IN (SELECT client_id FROM public.property_inquiries WHERE property_id = NEW.id)
            ORDER BY pi.client_id, coalesce(pi.last_inquiry_at, pi.created_at) DESC) x
          WHERE x.property_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.property_id = NEW.id AND d.client_id = n.client_id
                        AND crm_repair_private.deal_is_booked(d.stage, d.reservation_confirmed_at));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS crm_handoff_close_on_property ON public.properties;
CREATE TRIGGER crm_handoff_close_on_property AFTER UPDATE OF status, archived ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_property();
DROP TRIGGER IF EXISTS crm_hot_buyer_property_gone ON public.properties;
CREATE TRIGGER crm_hot_buyer_property_gone AFTER UPDATE OF status, archived ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.hot_buyer_property_gone();

-- [8] staff copies of «🔥 بديل» / «🔥 مشتري جاد», one shared «تم» ---------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.hot_notification_copy_to_staff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_route text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.client_id IS NULL THEN RETURN NULL; END IF;
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = NEW.user_id AND p.role = 'owner';
  IF v_company IS NULL THEN RETURN NULL; END IF;
  SELECT w.route_key INTO v_route FROM public.whatsapp_conversations w
   WHERE w.client_id = NEW.client_id AND w.company_id = v_company AND w.route_key IN ('barka', 'muscat')
   ORDER BY w.last_message_at DESC NULLS LAST LIMIT 1;
  -- same rule as staff chat access (can_access_whatsapp_conversation), evaluated for the route, not the caller
  -- (can_access_whatsapp_conversation reads auth.uid(), which is empty inside a trigger fired by the system)
  IF v_route IS NULL OR NOT EXISTS (SELECT 1 FROM public.company_lead_routes r
                                     WHERE r.company_id = v_company AND r.route_key = v_route
                                       AND (r.owner_only_inbox IS FALSE OR r.route_key = 'investment')) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, client_id, link, is_read)
  SELECT s.id, NEW.title, NEW.body, NEW.type, NEW.client_id, NEW.link, false
    FROM public.profiles s
   WHERE s.company_id = v_company AND s.role IN ('manager', 'agent') AND coalesce(s.is_active, false);
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS crm_hot_notification_copy_to_staff ON public.notifications;
CREATE TRIGGER crm_hot_notification_copy_to_staff AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (new.type = 'whatsapp_handoff' AND coalesce(new.title, '') ~ '^🔥 (بديل|مشتري جاد)')
  EXECUTE FUNCTION crm_repair_private.hot_notification_copy_to_staff();

CREATE OR REPLACE FUNCTION crm_repair_private.hot_notification_shared_read()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.client_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.notifications n SET is_read = true
   WHERE n.id <> NEW.id AND n.client_id = NEW.client_id AND n.type = NEW.type AND n.title = NEW.title
     AND NOT coalesce(n.is_read, false)
     AND n.user_id IN (SELECT p.id FROM public.profiles p
                        WHERE p.company_id = (SELECT q.company_id FROM public.profiles q WHERE q.id = NEW.user_id));
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS crm_hot_notification_shared_read ON public.notifications;
CREATE TRIGGER crm_hot_notification_shared_read AFTER UPDATE OF is_read ON public.notifications
  FOR EACH ROW WHEN (new.is_read AND NOT coalesce(old.is_read, false) AND new.type = 'whatsapp_handoff'
                     AND coalesce(new.title, '') ~ '^🔥 (بديل|مشتري جاد)')
  EXECUTE FUNCTION crm_repair_private.hot_notification_shared_read();

-- only the owner's row goes to WhatsApp (the staff copies must not send Ahmed the same alert again)
DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.hot_notification_to_whatsapp()'::regprocedure);
BEGIN
  def := replace(def, E'BEGIN\n  IF NEW.client_id IS NULL THEN',
                 E'BEGIN\n  IF NOT EXISTS (SELECT 1 FROM public.profiles op WHERE op.id = NEW.user_id AND op.role = ''owner'') THEN RETURN NULL; END IF;\n  IF NEW.client_id IS NULL THEN');
  IF position('op.role = ''owner''' in def) = 0 THEN RAISE EXCEPTION 'hot_notification_to_whatsapp: owner check not added'; END IF;
  EXECUTE def;
END $do$;

-- [55] contracts and Instagram to WhatsApp ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.owner_notification_to_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = NEW.user_id AND p.role = 'owner' AND coalesce(p.is_active, false);
  IF v_company IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
    body := jsonb_build_object('action', 'notify_owner', 'company_id', v_company, 'route_key', 'barka',
                               'text', left(concat_ws(E'\n', NEW.title, nullif(left(coalesce(NEW.body, ''), 600), '')), 900),
                               'event_key', 'owner_notification:' || NEW.id::text),
    timeout_milliseconds := 30000);
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS crm_owner_notification_to_whatsapp ON public.notifications;
CREATE TRIGGER crm_owner_notification_to_whatsapp AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (new.type IN ('property_archive', 'instagram_discovery'))
  EXECUTE FUNCTION crm_repair_private.owner_notification_to_whatsapp();

CREATE OR REPLACE FUNCTION crm_repair_private.agreement_ending_whatsapp()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record; n integer := 0; v_today date := (now() at time zone 'Asia/Muscat')::date;
BEGIN
  FOR r IN
    SELECT p.id, p.company_id, p.title, p.internal_name, p.agreement_end_date
      FROM public.properties p
     WHERE p.status = 'available' AND NOT coalesce(p.archived, false)
       AND p.agreement_end_date IS NOT NULL AND p.agreement_end_date BETWEEN v_today AND v_today + 14
  LOOP
    INSERT INTO public.crm_property_alerts (company_id, kind, ref_id)
    VALUES (r.company_id, 'agreement_ending_whatsapp:' || r.agreement_end_date::text, r.id)
    ON CONFLICT (kind, ref_id) DO NOTHING;
    IF FOUND THEN
      PERFORM net.http_post(
        url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
        body := jsonb_build_object('action', 'notify_owner', 'company_id', r.company_id, 'route_key', 'barka',
                                   'text', '📄 عقد التسويق ينتهي ' || to_char(r.agreement_end_date, 'YYYY-MM-DD') || ' ('
                                           || (r.agreement_end_date - v_today) || ' يوم): ' || coalesce(r.internal_name, r.title, 'عقار')
                                           || E'\nجدده أو بلغ المالك. التفاصيل في مربع «العقود».',
                                   'event_key', 'agreement_ending:' || r.id::text || ':' || r.agreement_end_date::text),
        timeout_milliseconds := 30000);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.agreement_ending_whatsapp() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'agreement_ending_whatsapp';
SELECT cron.schedule('agreement_ending_whatsapp', '5 6 * * *', $$ select crm_repair_private.agreement_ending_whatsapp(); $$);

-- [20] -----------------------------------------------------------------------------------------------------------------
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS utilities_note text;
COMMENT ON COLUMN public.properties.utilities_note IS 'Ahmed''s answer about water/electricity/internet for this property (18 Nov 2026, decision 20). Read by the reply agent.';
