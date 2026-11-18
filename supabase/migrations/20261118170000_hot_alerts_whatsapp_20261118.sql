-- SQL129 (18 Nov 2026, Ahmed: «كل تنبيه لازم يوصلني على الواتساب»). Checked on the live data: «🔥 مشتري جاد» and «📅 اجتماع»
-- handoffs reached his WhatsApp (owner_hot_alert applied), «📞 طلب اتصال» never did (3 in 3 days, e.g. Murad 17 Nov 18:03),
-- and an alert written only as a CRM notification (a serious buyer from the visit results, «🔥 بديل:» of SQL121) never did.
--   1. the handoff trigger (crm_owner_hot_alert) sends «طلب اتصال:» too (whatsapp-owner-hot-alert v14 knows it);
--   2. every new «🔥 / 📞 / 📅» notification of type whatsapp_handoff goes to his WhatsApp through notify_owner, once
--      (event key hot_notification:<id>), unless the same client's chat was just handed over with a reason the trigger above
--      already sends (no double message for one event). From the client's own branch number (Barka if unknown).
-- Rollback: 129-hot-alerts-whatsapp.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE d text; a text := '^\s*(مشتري جاد|تفاوض|اجتماع)\s*:';
BEGIN
  d := pg_get_functiondef('crm_repair_private.owner_hot_alert()'::regprocedure);
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'SQL129 refused: owner_hot_alert changed'; END IF;
  d := replace(d, a, '^\s*(مشتري جاد|تفاوض|اجتماع|طلب اتصال)\s*:');
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION crm_repair_private.hot_notification_to_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_route text; v_phone text; v_name text; v_text text;
BEGIN
  IF NEW.client_id IS NULL THEN
    SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = NEW.user_id;
  ELSE
    SELECT c.company_id, nullif(regexp_replace(coalesce(c.phone_normalized, c.phone, ''), '\D', '', 'g'), ''), c.name
      INTO v_company, v_phone, v_name FROM public.clients c WHERE c.id = NEW.client_id;
    -- the same event already goes by the handoff alert: the client's chat was handed over in the last 5 minutes
    IF EXISTS (SELECT 1 FROM public.whatsapp_conversations w
                WHERE w.client_id = NEW.client_id AND w.human_handoff_required AND w.route_key IN ('barka', 'muscat')
                  AND coalesce(w.handoff_reason, '') ~ '^\s*(مشتري جاد|تفاوض|اجتماع|طلب اتصال)\s*:'
                  AND w.handoff_updated_at > now() - interval '5 minutes') THEN
      RETURN NULL;
    END IF;
    SELECT w.route_key INTO v_route FROM public.whatsapp_conversations w
     WHERE w.client_id = NEW.client_id AND w.route_key IN ('barka', 'muscat') ORDER BY w.last_message_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_company IS NULL THEN RETURN NULL; END IF;
  v_text := left(concat_ws(E'\n', NEW.title, nullif(left(coalesce(NEW.body, ''), 500), ''),
                   CASE WHEN v_phone IS NOT NULL THEN 'افتح المحادثة: https://wa.me/' || v_phone END), 900);
  PERFORM net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
    body := jsonb_build_object('action', 'notify_owner', 'company_id', v_company, 'route_key', coalesce(v_route, 'barka'),
                               'text', v_text, 'event_key', 'hot_notification:' || NEW.id::text),
    timeout_milliseconds := 30000);
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.hot_notification_to_whatsapp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_hot_notification_to_whatsapp ON public.notifications;
CREATE TRIGGER crm_hot_notification_to_whatsapp AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (NEW.type = 'whatsapp_handoff' AND coalesce(NEW.title, '') ~ '^(🔥|📞|📅)')
  EXECUTE FUNCTION crm_repair_private.hot_notification_to_whatsapp();
