-- SQL166 (27 Nov 2026, Ahmed: «إذا توفر عقار جديد بالمواصفات اللي يبحث عنها أي زبون كان موجود معانا، أريد على طول توصل له رسالة
-- ... إذا ما رد ... بعد يوم كامل ... رسالة فيها تفاصيل العقار ... إذا ما رد عاد الحين خلاص»). The new-listing alert, automatic:
--   1. whatsapp_automation_runtime.new_listing_auto (OFF by default). Ahmed turns it on after he saw the dry run.
--   2. crm_repair_private.outreach_auto_new_listing(): a «نزل عندنا … لين الحين تبحث ؟» row the daily review already read against
--      the client's chat (reviewed_at set, still pending = the review kept it) is approved and goes in the next send run
--      (9 AM - 9 PM Oman). Same pattern as the sold notice (SQL132). Only rows made in the last 3 days.
--   3. cron outreach_listing_details (hourly, 9 AM - 7 PM Oman): whatsapp-outreach queue_listing_details, the second message with
--      the details to a client who did not answer for a whole day; then nothing more.
-- Who gets it (supabase/functions/_shared/listing-match.mjs): every matching active buyer, no longer the best 20; «قريب» (same
-- wilayat) only when the client did not name another area. The «found / no longer searching» exit is the reply agent's (14 Nov):
-- his active requests are closed (status cancelled, never deleted).
-- Rollback: 166-new-listing-auto.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_automation_runtime ADD COLUMN IF NOT EXISTS new_listing_auto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION crm_repair_private.outreach_auto_new_listing()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.whatsapp_outreach_queue q
     SET status = 'approved', approved_at = now(), scheduled_for = least(coalesce(q.scheduled_for, now()), now()), reason = 'auto_new_listing'
   WHERE q.kind = 'new_listing' AND q.status = 'pending' AND NOT coalesce(q.dry_run, false)
     AND q.reviewed_at IS NOT NULL AND q.created_at >= now() - interval '3 days'
     AND EXISTS (SELECT 1 FROM public.whatsapp_automation_runtime r WHERE r.company_id = q.company_id AND r.new_listing_auto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.outreach_auto_new_listing() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('outreach_auto_new_listing', 'outreach_listing_details');
SELECT cron.schedule('outreach_auto_new_listing', '4-59/5 * * * *', $$ select crm_repair_private.outreach_auto_new_listing(); $$);
SELECT cron.schedule('outreach_listing_details', '20 5-15 * * *', $$ select net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-outreach', headers:=jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')), body:=jsonb_build_object('action','queue_listing_details'), timeout_milliseconds:=60000); $$);
