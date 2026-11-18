-- SQL133 (18 Nov 2026, Ahmed: «إيوا، تلقائي»). A sold / reserved notice («بخصوص … اللي سألت عنها … انحجزت» + «تحب تشوف خيارات
-- ثانية ؟») now goes by itself outside the 24-hour window too, with its approved template (property_booked_options_ar_v1 /
-- property_unit_booked_ar_v1, rated MARKETING by Meta). This is Ahmed's own exception to his rule of 5 Nov 2026 («قوالب
-- MARKETING تبقى في شاشة الموافقة») for this one message only; every other MARKETING template still waits for him.
-- The review still runs first (only rows it kept are approved), the sending hours (9am–9pm) and the hold rules of
-- outreach_send_approved are unchanged. Rollback: 133-sold-notice-template.rollback.sql (back to the SQL132 body).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.outreach_auto_sold_notice()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.whatsapp_outreach_queue q
     SET status = 'approved', approved_at = now(), scheduled_for = least(coalesce(q.scheduled_for, now()), now()),
         reason = 'auto_sold_notice'
   WHERE q.kind = 'property_sold' AND q.status = 'pending' AND NOT coalesce(q.dry_run, false)
     AND q.reviewed_at IS NOT NULL
     AND q.created_at >= timestamptz '2026-11-18 09:30:00+04';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.outreach_auto_sold_notice() FROM PUBLIC, anon, authenticated;
