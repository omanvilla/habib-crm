-- SQL102 (14 Nov 2026, Ahmed: «نعم، أضفه»): a monthly counter of the system's WhatsApp replies per branch number, and an alert.
--   Since 1 Oct 2026 Meta gives each business phone number 1,000 free service (free-form) messages a month; after that an
--   account with no payment method gets nothing delivered (error 131042). The Barka number ran out on 13 Nov and nobody knew
--   until a customer was lost for a day. This counts what the CRM itself sent (not templates, not what was typed in the
--   WhatsApp Business app), by the Muscat calendar month. It is an estimate: Meta counts by its own account time zone, and a
--   few system sends are not kept in whatsapp_messages.
--   1. crm_repair_private.whatsapp_usage_rows(company): one row per branch number (used, free limit, blocked).
--      «blocked» = the last five system messages on that number all failed.
--   2. public.crm_whatsapp_usage(): the same for the signed-in account's company, as json, for the home page.
--   3. crm_repair_private.whatsapp_usage_alert() + cron «crm_whatsapp_usage_alert» every 15 minutes: a CRM notification to the
--      owner when a number is blocked (at most once in 12 hours) and when it passes 800 (once a month per number).
-- Only adds: three functions and one cron job. No table, no column, no trigger, no message is sent to anyone.

CREATE OR REPLACE FUNCTION crm_repair_private.whatsapp_usage_rows(p_company uuid)
 RETURNS TABLE(route_key text, used integer, free_limit integer, blocked boolean, last_ok timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT l.route_key, l.meta_phone_number_id FROM public.company_lead_routes l
     WHERE l.company_id = p_company AND l.route_key IN ('muscat','barka') AND l.meta_phone_number_id IS NOT NULL
  ), m AS (
    SELECT r.route_key, w.delivery_status, w.message_timestamp,
           row_number() OVER (PARTITION BY r.route_key ORDER BY w.message_timestamp DESC) AS rn
      FROM r JOIN public.whatsapp_messages w
        ON w.company_id = p_company AND w.sender_wa_id = r.meta_phone_number_id AND w.direction = 'outbound'
       AND COALESCE(w.channel_source, '') <> 'whatsapp_business_app' AND w.message_type <> 'template'
       AND w.message_timestamp >= (date_trunc('month', now() AT TIME ZONE 'Asia/Muscat') AT TIME ZONE 'Asia/Muscat')
  )
  SELECT r.route_key,
         COALESCE(count(m.rn) FILTER (WHERE m.delivery_status IS DISTINCT FROM 'failed'), 0)::int AS used,
         1000 AS free_limit,
         (count(m.rn) FILTER (WHERE m.rn <= 5) = 5 AND count(m.rn) FILTER (WHERE m.rn <= 5 AND m.delivery_status = 'failed') = 5) AS blocked,
         max(m.message_timestamp) FILTER (WHERE m.delivery_status IS DISTINCT FROM 'failed') AS last_ok
    FROM r LEFT JOIN m ON m.route_key = r.route_key
   GROUP BY r.route_key
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.whatsapp_usage_rows(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_whatsapp_usage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.my_company() IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN '[]'::jsonb
    ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('route_key', u.route_key, 'used', u.used, 'free_limit', u.free_limit, 'blocked', u.blocked, 'last_ok', u.last_ok)
                            ORDER BY u.route_key)
                     FROM crm_repair_private.whatsapp_usage_rows(public.my_company()) u), '[]'::jsonb) END
$function$;
REVOKE ALL ON FUNCTION public.crm_whatsapp_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_usage() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.whatsapp_usage_alert()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; u record; v_name text; v_title text; v_body text; v_since timestamptz; n integer := 0;
BEGIN
  FOR c IN SELECT DISTINCT l.company_id FROM public.company_lead_routes l WHERE l.route_key IN ('muscat','barka') LOOP
    FOR u IN SELECT * FROM crm_repair_private.whatsapp_usage_rows(c.company_id) LOOP
      v_name := CASE u.route_key WHEN 'barka' THEN 'بركاء' ELSE 'مسقط' END;
      IF u.blocked THEN
        v_title := '⚠️ ردود النظام واقفة على رقم ' || v_name;
        v_body := 'آخر خمس رسائل من النظام على رقم ' || v_name || ' ما وصلت للعملاء. الأغلب إن الردود المجانية (1000 في الشهر) خلصت والحساب بدون طريقة دفع في ميتا. رد على العملاء من تطبيق واتساب بزنس لين تنحل.';
        v_since := now() - interval '12 hours';
      ELSIF u.used >= 800 THEN
        v_title := '⚠️ رقم ' || v_name || ' قرّب يخلص الردود المجانية';
        v_body := 'النظام أرسل تقريباً ' || u.used || ' من 1000 رد مجاني هذا الشهر على رقم ' || v_name || '. بعد الألف ميتا توقف التوصيل إذا الحساب بدون طريقة دفع.';
        v_since := date_trunc('month', now() AT TIME ZONE 'Asia/Muscat') AT TIME ZONE 'Asia/Muscat';
      ELSE
        CONTINUE;
      END IF;
      INSERT INTO public.notifications (user_id, type, is_read, link, title, body)
      SELECT p.id, 'system_alert', false, 'whatsapp', v_title, v_body
        FROM public.profiles p
       WHERE p.company_id = c.company_id AND p.role = 'owner' AND p.is_active IS NOT FALSE
         AND NOT EXISTS (SELECT 1 FROM public.notifications x WHERE x.user_id = p.id AND x.type = 'system_alert' AND x.title = v_title AND x.created_at >= v_since);
      IF FOUND THEN n := n + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.whatsapp_usage_alert() FROM PUBLIC, anon, authenticated;

DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_whatsapp_usage_alert') THEN PERFORM cron.unschedule('crm_whatsapp_usage_alert'); END IF;
END $cron$;
SELECT cron.schedule('crm_whatsapp_usage_alert', '*/15 * * * *', $job$select crm_repair_private.whatsapp_usage_alert()$job$);
