-- SQL148 (19 Nov 2026, Ahmed: «حالات الـ CRM تتأخر عن المحادثة… تصليحات بس، بدون صفحات جديدة»).
-- Three live examples of 19 Nov:
--   1. عبدالله الرميمي: the reserved notice «بخصوص الفيلا اللي سألت عنها في بركاء الرميس انحجزت» went at 10:10 on 18 Nov, and his
--      visit on «فيلا الرميس 59 هشام» stayed «scheduled» (the visit watcher even moved it to 19 Nov 16:00 after the notice).
--   2. خالد الرزيقي: his last message is 8 Nov; Ahmed pressed «تم» on 17 Nov; the reply agent ran again on that 8 Nov message
--      (16 Nov ×3, 18 Nov ×2: the draft row is reused, so no new draft shows it) and every run raised «🔥 مشتري جاد» again, with
--      a fresh notification and a WhatsApp alert, as if it were new.
--   3. «اجتماع: عادل البلوشي … (ينتظر تأكيدك)»: Ahmed sent the office location at 08:24 on 19 Nov and the task still says
--      it waits for his confirmation.
-- Fixes (nothing is deleted):
--   أ. an outbound message that says «انحجز / انباع» cancels the client's coming visits (today or later) on a property that is
--      sold or reserved, with the reason in the note; and a visit on such a property that the system (not a signed-in person)
--      puts back to scheduled after the client was told is kept cancelled.
--   ب. a hot handoff (مشتري جاد / تفاوض / طلب اتصال / اجتماع) is not renewed by a run on an old client message: when the client
--      wrote nothing after «تم», or his last message is older than 24 hours and already had a handoff after it, the
--      handoff columns keep their old values (so the WhatsApp alert trigger does not fire). A hot notification written for a
--      client whose newest message is older than 24 hours or older than «تم» is saved as read and sends no WhatsApp.
--      public.crm_last_message_by_clients(uuid[]): who wrote last (العميل / العقل / أحمد / the staff name) and when, for
--      «عملاء يحتاجونك الحين».
--   ج. a person (Ahmed or staff) answering a client with a day, an hour or a location turns his open meeting task
--      «(ينتظر تأكيدك)» into «(انرد عليه، ينتظر يحدد اليوم)», with a line in the notes. The task stays open.
-- Rollback: 148-crm-state-follows-chat.rollback.sql
SET LOCAL lock_timeout = '10s';

-- ---------- أ. visits on a property that went, once the client is told ----------
CREATE OR REPLACE FUNCTION crm_repair_private.gone_notice_cancels_visits()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_client uuid; v_today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
BEGIN
  IF NEW.direction <> 'outbound' OR coalesce(NEW.delivery_status, '') = 'failed'
     OR coalesce(NEW.body, '') !~ '(انحجز|انباع|تم البيع|تم الحجز)' THEN RETURN NULL; END IF;
  v_client := coalesce(NEW.client_id, (SELECT c.client_id FROM public.whatsapp_conversations c WHERE c.id = NEW.conversation_id));
  IF v_client IS NULL THEN RETURN NULL; END IF;
  UPDATE public.viewings v
     SET status = 'cancelled',
         notes = left(concat_ws(E'\n', v.notes, 'انلغت تلقائياً (' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || '): '
                   || coalesce(p.internal_name, p.title, 'العقار') || CASE WHEN p.status = 'sold' THEN ' انباع' ELSE ' انحجز' END
                   || ' وانبلغ العميل'), 4000)
    FROM public.properties p
   WHERE p.id = v.property_id AND p.status IN ('sold', 'reserved')
     AND v.company_id = NEW.company_id AND v.client_id = v_client
     AND NOT coalesce(v.archived, false)
     AND v.status IN ('scheduled', 'confirmed', 'postponed')
     AND v.viewing_date >= v_today;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL; -- never block a message
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.gone_notice_cancels_visits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_gone_notice_cancels_visits ON public.whatsapp_messages;
CREATE TRIGGER crm_gone_notice_cancels_visits AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'outbound') EXECUTE FUNCTION crm_repair_private.gone_notice_cancels_visits();

-- the visit watcher (or any system job, auth.uid() is null) moving a visit back to scheduled on a property the client was told is gone
CREATE OR REPLACE FUNCTION crm_repair_private.keep_gone_visit_cancelled()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE p record;
BEGIN
  IF auth.uid() IS NOT NULL OR NEW.status NOT IN ('scheduled', 'confirmed', 'postponed')
     OR (OLD.status = NEW.status AND OLD.viewing_date IS NOT DISTINCT FROM NEW.viewing_date AND OLD.viewing_time IS NOT DISTINCT FROM NEW.viewing_time)
     OR NEW.viewing_date < (now() AT TIME ZONE 'Asia/Muscat')::date THEN RETURN NEW; END IF;
  SELECT x.status, coalesce(x.internal_name, x.title, 'العقار') AS name INTO p FROM public.properties x WHERE x.id = NEW.property_id;
  IF p.status IS NULL OR p.status NOT IN ('sold', 'reserved') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages m
              WHERE m.client_id = NEW.client_id AND m.company_id = NEW.company_id AND m.direction = 'outbound'
                AND coalesce(m.delivery_status, '') <> 'failed'
                AND coalesce(m.message_timestamp, m.created_at) > now() - interval '14 days'
                AND coalesce(m.body, '') ~ '(انحجز|انباع|تم البيع|تم الحجز)') THEN
    NEW.status := 'cancelled';
    NEW.notes := left(concat_ws(E'\n', NEW.notes, 'انلغت تلقائياً (' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || '): '
                   || p.name || CASE WHEN p.status = 'sold' THEN ' انباع' ELSE ' انحجز' END || ' وانبلغ العميل'), 4000);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.keep_gone_visit_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_keep_gone_visit_cancelled ON public.viewings;
CREATE TRIGGER crm_keep_gone_visit_cancelled BEFORE UPDATE OF status, viewing_date, viewing_time ON public.viewings
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.keep_gone_visit_cancelled();

-- ---------- ب. a run on an old client message does not renew a hot handoff ----------
CREATE OR REPLACE FUNCTION crm_repair_private.no_stale_hot_handoff()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  IF NEW.human_handoff_required
     AND coalesce(NEW.route_key, '') IN ('barka', 'muscat')
     AND coalesce(NEW.handoff_reason, '') ~ '^\s*(مشتري جاد|تفاوض|طلب اتصال|اجتماع)\s*:'
     AND (NOT coalesce(OLD.human_handoff_required, false) OR OLD.handoff_reason IS DISTINCT FROM NEW.handoff_reason
          OR OLD.handoff_updated_at IS DISTINCT FROM NEW.handoff_updated_at)
     AND NEW.last_inbound_at IS NOT NULL
     AND ((OLD.owner_alert_done_at IS NOT NULL AND NEW.last_inbound_at <= OLD.owner_alert_done_at)
          OR (NEW.last_inbound_at < now() - interval '24 hours' AND NEW.last_inbound_at <= coalesce(OLD.handoff_updated_at, '-infinity'::timestamptz))) THEN
    NEW.human_handoff_required := OLD.human_handoff_required;
    NEW.handoff_reason := OLD.handoff_reason;
    NEW.handoff_updated_at := OLD.handoff_updated_at;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.no_stale_hot_handoff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_no_stale_hot_handoff ON public.whatsapp_conversations;
CREATE TRIGGER crm_no_stale_hot_handoff BEFORE UPDATE OF human_handoff_required, handoff_reason, handoff_updated_at ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.no_stale_hot_handoff();

-- a hot notification for a client who wrote nothing new: kept as read (it stays in the table), no list row, no WhatsApp
CREATE OR REPLACE FUNCTION crm_repair_private.quiet_stale_hot_notification()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.type = 'whatsapp_handoff' AND NEW.client_id IS NOT NULL AND NOT coalesce(NEW.is_read, false)
     AND coalesce(NEW.title, '') ~ '^(🔥 مشتري جاد|📞 طلب اتصال|📅 اجتماع|محادثة تحتاجك)'
     AND EXISTS (SELECT 1 FROM public.whatsapp_conversations w
                  WHERE w.client_id = NEW.client_id AND w.route_key IN ('barka', 'muscat') AND w.last_inbound_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations w
                      WHERE w.client_id = NEW.client_id AND w.route_key IN ('barka', 'muscat')
                        AND w.last_inbound_at > greatest(now() - interval '24 hours', coalesce(w.owner_alert_done_at, '-infinity'::timestamptz))) THEN
    NEW.is_read := true;
    NEW.body := left(concat_ws(E'\n', NEW.body, '(ما نبّه: آخر رسالة من العميل قديمة أو انتهت بـ«تم»)'), 1000);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.quiet_stale_hot_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_quiet_stale_hot_notification ON public.notifications;
CREATE TRIGGER crm_quiet_stale_hot_notification BEFORE INSERT ON public.notifications
  FOR EACH ROW WHEN (NEW.type = 'whatsapp_handoff') EXECUTE FUNCTION crm_repair_private.quiet_stale_hot_notification();

-- the WhatsApp copy (SQL129) goes for unread ones only
DROP TRIGGER IF EXISTS crm_hot_notification_to_whatsapp ON public.notifications;
CREATE TRIGGER crm_hot_notification_to_whatsapp AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (NEW.type = 'whatsapp_handoff' AND coalesce(NEW.title, '') ~ '^(🔥|📞|📅)' AND NOT coalesce(NEW.is_read, false))
  EXECUTE FUNCTION crm_repair_private.hot_notification_to_whatsapp();

-- who wrote last and when, per client (barka / muscat chats the caller can open)
CREATE OR REPLACE FUNCTION public.crm_last_message_by_clients(p_clients uuid[])
 RETURNS TABLE(client_id uuid, who text, at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_role text := public.my_role();
BEGIN
  IF v_company IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'agent') THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.id, CASE WHEN l.direction = 'inbound' THEN 'العميل'
                    WHEN coalesce(l.actor_type, '') <> 'human' THEN 'العقل'
                    WHEN l.sent_by_user_id IS NULL OR pr.role = 'owner' THEN 'أحمد'
                    ELSE coalesce(nullif(trim(pr.full_name), ''), 'الموظف') END,
         l.at
    FROM unnest(p_clients[1:60]) AS c(id)
    CROSS JOIN LATERAL (
      SELECT m.direction, m.actor_type, m.sent_by_user_id, coalesce(m.message_timestamp, m.created_at) AS at
        FROM public.whatsapp_messages m
        JOIN public.whatsapp_conversations w ON w.id = m.conversation_id
       WHERE m.client_id = c.id AND m.company_id = v_company
         AND w.route_key IN ('barka', 'muscat')
         AND m.direction IN ('inbound', 'outbound')
         AND coalesce(m.message_type, '') NOT IN ('reaction', 'edit', 'revoke', 'system', 'unsupported')
         AND coalesce(m.delivery_status, '') <> 'failed'
         AND (v_role = 'owner' OR crm_repair_private.can_access_whatsapp_conversation(v_company, w.id))
       ORDER BY m.message_timestamp DESC NULLS LAST, m.created_at DESC
       LIMIT 1) l
    LEFT JOIN public.profiles pr ON pr.id = l.sent_by_user_id;
END $function$;
REVOKE ALL ON FUNCTION public.crm_last_message_by_clients(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_last_message_by_clients(uuid[]) TO authenticated;

-- ---------- ج. a meeting task after a person answered with a day, an hour or a location ----------
CREATE OR REPLACE FUNCTION crm_repair_private.meeting_answered_by_person()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_client uuid;
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.actor_type <> 'human' OR coalesce(NEW.delivery_status, '') = 'failed' THEN RETURN NULL; END IF;
  IF NOT (coalesce(NEW.message_type, '') = 'location'
          OR coalesce(NEW.body, '') ~* '(موقع|لوكيشن|location|maps\.|goo\.gl|الساعة|الساعه|بكره|بكرة|باكر|اليوم|السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعة|الجمعه|الصبح|الصباح|الظهر|العصر|المغرب|العشاء|[0-9٠-٩]{1,2}\s*[:.]\s*[0-9٠-٩]{2})') THEN
    RETURN NULL;
  END IF;
  v_client := coalesce(NEW.client_id, (SELECT c.client_id FROM public.whatsapp_conversations c WHERE c.id = NEW.conversation_id));
  IF v_client IS NULL THEN RETURN NULL; END IF;
  UPDATE public.tasks t
     SET title = CASE WHEN t.title LIKE '%(ينتظر تأكيدك)%' THEN replace(t.title, '(ينتظر تأكيدك)', '(انرد عليه، ينتظر يحدد اليوم)')
                      ELSE t.title || ' (انرد عليه، ينتظر يحدد اليوم)' END,
         notes = left(concat_ws(E'\n', t.notes, 'انرد عليه (' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI')
                   || '): انرسل له موعد أو موقع من المكتب، ينتظر العميل يحدد اليوم'), 4000)
   WHERE NOT coalesce(t.done, false) AND t.company_id = NEW.company_id AND t.client_id = v_client
     AND t.title ~ '^\s*اجتماع' AND t.title NOT LIKE '%انرد عليه%'
     AND t.created_at < coalesce(NEW.message_timestamp, now());
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.meeting_answered_by_person() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_meeting_answered_by_person ON public.whatsapp_messages;
CREATE TRIGGER crm_meeting_answered_by_person AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'outbound' AND NEW.actor_type = 'human') EXECUTE FUNCTION crm_repair_private.meeting_answered_by_person();
