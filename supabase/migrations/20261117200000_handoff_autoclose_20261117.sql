-- SQL120 (17 Nov 2026, Ahmed: «نعم، طبّق»). Handed-over chats (مشتري جاد / تفاوض / طلب اتصال / اجتماع) kept coming back in the
-- 19:30 report and «العملاء اللي يحتاجون أحمد الحين» after the matter was over (👑💜 / حسناء, 4850e47a: the villa she wanted was
-- reserved by someone else, owner_alert_done_at stayed null). Root cause: «تم» was compared with handoff_updated_at, and the agent
-- moves handoff_updated_at without any new client message (16 Nov 09:26-09:58 several chats moved at once).
--  1. public.crm_hot_handoff_open(row): the one rule. Open = not «تم» yet, or the client wrote after «تم» AND the agent handed it
--     over again after «تم». A moved handoff_updated_at alone no longer brings a chat back. (Replaces SQL88's «same kind never
--     comes back» in the app.)
--  2. Auto «تم» (owner_alert_done_at = now(), reason kept, one activities row; nothing deleted, human_handoff_required untouched so
--     the agent behaves as before): deal closed / commission collected / reservation confirmed; the client's last property becomes
--     sold or reserved; a call logged after the handoff (crm_log_call); a meeting task closed with «أكّد الموعد».
--  3. public.crm_mark_handoff_done(conversation, note): service_role only, for Claude at Ahmed's explicit request.
--  4. public.crm_owner_open_handoffs(): the list itself with a readable name (clients.name, or phone + last property when the name
--     is an emoji or empty). Security invoker: staff see only their own chats through RLS.
-- Rollback: 120-handoff-autoclose.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_hot_handoff_open(w public.whatsapp_conversations)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $$
  SELECT coalesce(w.human_handoff_required, false)
     AND coalesce(w.handoff_reason, '') ~ '^\s*(مشتري جاد|تفاوض|طلب اتصال|اجتماع)\s*:'
     AND (w.owner_alert_done_at IS NULL
          OR (coalesce(w.handoff_updated_at, w.updated_at) > w.owner_alert_done_at
              AND w.last_inbound_at > w.owner_alert_done_at))
$$;

-- closes the open hot handoffs of one client (or one conversation). p_before: only handoffs made before this time (a call after
-- the handoff). p_meeting_only: only «اجتماع:» handoffs.
CREATE OR REPLACE FUNCTION crm_repair_private.close_hot_handoffs(p_company uuid, p_client uuid, p_why text,
  p_before timestamptz DEFAULT NULL, p_meeting_only boolean DEFAULT false)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE r record; n integer := 0; v_text text;
BEGIN
  IF p_company IS NULL OR p_client IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT w.id, w.company_id, w.client_id, w.handoff_reason FROM public.whatsapp_conversations w
            WHERE w.company_id = p_company AND w.client_id = p_client
              AND coalesce(w.route_key, '') NOT IN ('owner', 'investment')
              AND public.crm_hot_handoff_open(w)
              AND (p_before IS NULL OR coalesce(w.handoff_updated_at, w.updated_at) < p_before)
              AND (NOT p_meeting_only OR w.handoff_reason ~ '^\s*اجتماع')
            FOR UPDATE
  LOOP
    UPDATE public.whatsapp_conversations SET owner_alert_done_at = now(), owner_alert_done_reason = left(r.handoff_reason, 500)
     WHERE id = r.id;
    v_text := 'تم تلقائي (' || p_why || '): ' || left(coalesce(r.handoff_reason, ''), 300);
    INSERT INTO public.activities (company_id, user_id, client_id, type, activity_type, channel, direction, actor_type,
                                   description, activity_text, occurred_at)
    VALUES (r.company_id, auth.uid(), r.client_id, 'system', 'system', 'system', 'internal', 'automated', v_text, v_text, now());
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.close_hot_handoffs(uuid, uuid, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;

-- deal closed / commission collected / reservation confirmed
CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_deal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF new.client_id IS NOT NULL AND (
       (new.stage IN ('closed', 'commission_collected')
          AND (TG_OP = 'INSERT' OR old.stage IS DISTINCT FROM new.stage))
    OR (new.reservation_confirmed_at IS NOT NULL
          AND (TG_OP = 'INSERT' OR old.reservation_confirmed_at IS NULL))) THEN
    PERFORM crm_repair_private.close_hot_handoffs(new.company_id, new.client_id,
      CASE WHEN new.reservation_confirmed_at IS NOT NULL AND new.stage NOT IN ('closed', 'commission_collected')
           THEN 'انحجزت الصفقة' ELSE 'انقفلت الصفقة' END);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL; -- never block a deal save
END $$;
DROP TRIGGER IF EXISTS crm_handoff_close_on_deal ON public.deals;
CREATE TRIGGER crm_handoff_close_on_deal AFTER INSERT OR UPDATE OF stage, reservation_confirmed_at ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_deal();

-- the client's last property (latest inquiry) or a property in his deal becomes sold / reserved
CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_property() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE c uuid;
BEGIN
  IF new.status IN ('sold', 'reserved') AND old.status IS DISTINCT FROM new.status THEN
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
      PERFORM crm_repair_private.close_hot_handoffs(new.company_id, c,
        CASE new.status WHEN 'sold' THEN 'العقار انباع' ELSE 'العقار انحجز' END || ': ' || coalesce(new.internal_name, new.title, ''));
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crm_handoff_close_on_property ON public.properties;
CREATE TRIGGER crm_handoff_close_on_property AFTER UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_property();

-- «سجّل اتصال» (crm_log_call: channel call) after the handoff
CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_call() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF new.client_id IS NOT NULL AND (new.channel = 'call' OR new.type = 'call') THEN
    PERFORM crm_repair_private.close_hot_handoffs(new.company_id, new.client_id, 'انسجل اتصال',
      coalesce(new.occurred_at, new.created_at, now()));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crm_handoff_close_on_call ON public.activities;
CREATE TRIGGER crm_handoff_close_on_call AFTER INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_call();

-- «أكّد الموعد» closes the meeting task with a «تأكد الموعد:» note (crm-calls-meetings.js)
CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_meeting_task() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF new.client_id IS NOT NULL AND coalesce(new.done, false) AND NOT coalesce(old.done, false)
     AND coalesce(new.notes, '') LIKE '%تأكد الموعد:%' THEN
    PERFORM crm_repair_private.close_hot_handoffs(new.company_id, new.client_id, 'تأكد الموعد', NULL, true);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crm_handoff_close_on_meeting_task ON public.tasks;
CREATE TRIGGER crm_handoff_close_on_meeting_task AFTER UPDATE OF done ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_meeting_task();

-- Claude, at Ahmed's explicit request: «خلصت موضوع فلان». Only owner_alert_done_at(+reason) and one activities row.
CREATE OR REPLACE FUNCTION public.crm_mark_handoff_done(p_conversation uuid, p_note text DEFAULT NULL)
 RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_at timestamptz := now(); r record; v_text text;
BEGIN
  SELECT id, company_id, client_id, handoff_reason INTO r FROM public.whatsapp_conversations WHERE id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.whatsapp_conversations SET owner_alert_done_at = v_at, owner_alert_done_reason = left(handoff_reason, 500)
   WHERE id = p_conversation;
  v_text := 'تم (Claude بطلب أحمد)' || coalesce(': ' || nullif(btrim(p_note), ''), '') || ' | ' || left(coalesce(r.handoff_reason, ''), 300);
  INSERT INTO public.activities (company_id, client_id, type, activity_type, channel, direction, actor_type,
                                 description, activity_text, occurred_at)
  VALUES (r.company_id, r.client_id, 'note', 'note', 'system', 'internal', 'automated', v_text, v_text, v_at);
  RETURN v_at;
END $$;
REVOKE ALL ON FUNCTION public.crm_mark_handoff_done(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mark_handoff_done(uuid, text) TO service_role;

-- the list for the 19:30 report, the app and Claude
CREATE OR REPLACE FUNCTION public.crm_owner_open_handoffs()
 RETURNS TABLE (conversation_id uuid, client_id uuid, display_name text, phone text, kind text, reason text,
                handoff_at timestamptz, last_inbound_at timestamptz, route_key text, last_property text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT w.id, w.client_id,
         CASE WHEN coalesce(cl.name, '') ~ '[[:alpha:]]' THEN btrim(cl.name)
              WHEN coalesce(w.customer_name, '') ~ '[[:alpha:]]' AND lp.t IS NULL THEN btrim(w.customer_name)
              ELSE concat_ws(' · ', coalesce(cl.phone_normalized, cl.phone, w.customer_wa_id), lp.t) END,
         coalesce(cl.phone_normalized, cl.phone, w.customer_wa_id),
         btrim(split_part(w.handoff_reason, ':', 1)), w.handoff_reason,
         coalesce(w.handoff_updated_at, w.updated_at), w.last_inbound_at, w.route_key, lp.t
    FROM public.whatsapp_conversations w
    LEFT JOIN public.clients cl ON cl.id = w.client_id
    LEFT JOIN LATERAL (
      SELECT concat_ws(' / ', coalesce(p.internal_name, p.title), coalesce(p.area, p.wilayat)) t
        FROM public.property_inquiries pi JOIN public.properties p ON p.id = pi.property_id
       WHERE pi.client_id = w.client_id ORDER BY coalesce(pi.last_inquiry_at, pi.created_at) DESC LIMIT 1) lp ON true
   WHERE coalesce(w.route_key, '') NOT IN ('owner', 'investment') AND public.crm_hot_handoff_open(w)
   ORDER BY coalesce(w.handoff_updated_at, w.updated_at)
$$;
REVOKE ALL ON FUNCTION public.crm_owner_open_handoffs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_owner_open_handoffs() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_hot_handoff_open(public.whatsapp_conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_hot_handoff_open(public.whatsapp_conversations) TO authenticated, service_role;
