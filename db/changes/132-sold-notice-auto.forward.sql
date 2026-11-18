-- SQL132 (18 Nov 2026, Ahmed on حمزة الكندي: «اليوم جاء العقل رسله التذكير بخصوص الزيارة… والفيلا أساساً انحجزت… وليش ما وصلته
-- أساساً رسالة إن هذاك العقار انباع؟… أي عقار ينباع أي شخص سائل، حتى لو ما كان فيه بديل لازم يخبر»).
-- What happened: «فيلا الرميس 59 هشام» was reserved on 17 Nov; at 15:27 the outreach queued «بخصوص الفيلا اللي سألت عنها في
-- بركاء الرميس انحجزت» + «تحب تشوف خيارات ثانية ؟» for 90 clients (46 skipped by the review, 44 pending), and every pending row
-- waited for Ahmed's approval, so Hamza never got it; at 09:08 today the visit confirmation (whatsapp-visit-followup-auto) asked
-- him «نأكد موعد زيارة العقار … اليوم الساعة 12 الظهر ؟» for the reserved villa.
--   1. crm_visit_confirm_candidates and crm_fast_visit_candidates leave out a visit whose property is sold or reserved (the
--      after-visit question still goes for a visit that was done);
--   2. a sold / reserved notice the review kept (pending, reviewed) goes out by itself while the client's 24-hour window is open
--      (free text, the same two lines): job outreach_auto_sold_notice every 5 minutes approves it; outreach_send_approved sends
--      it 9am–9pm as before. Outside the window it still waits: its template is rated MARKETING by Meta, and Ahmed's standing
--      rule (5 Nov) keeps MARKETING templates for his approval. Only rows queued from now on (the 44 of 17 Nov wait for him).
-- Rollback: 132-sold-notice-auto.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE d text; a text; n int;
BEGIN
  d := pg_get_functiondef('public.crm_visit_confirm_candidates()'::regprocedure);
  a := 'WHERE li.last_in + interval ''24 hours'' > now() + interval ''10 minutes''';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'SQL132 refused: crm_visit_confirm_candidates changed (% matches)', n; END IF;
  d := replace(d, a, a || E'\n     -- SQL132: never for a property that is sold or reserved\n     AND coalesce(p.status, ''available'') NOT IN (''sold'', ''reserved'')');
  EXECUTE d;

  d := pg_get_functiondef('public.crm_fast_visit_candidates()'::regprocedure);
  a := 'AND vw.status IN (''scheduled'',''confirmed'',''done'')';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'SQL132 refused: crm_fast_visit_candidates changed (% matches)', n; END IF;
  d := replace(d, a, a || E'\n       -- SQL132: a visit that never happened because the property went is not asked about\n       AND NOT (vw.status <> ''done'' AND EXISTS (SELECT 1 FROM public.properties px WHERE px.id = vw.property_id AND px.status IN (''sold'', ''reserved'')))');
  EXECUTE d;
END $$;

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
    FROM public.whatsapp_conversations w
   WHERE w.id = q.conversation_id
     AND q.kind = 'property_sold' AND q.status = 'pending' AND NOT coalesce(q.dry_run, false)
     AND q.reviewed_at IS NOT NULL
     AND q.created_at >= timestamptz '2026-11-18 09:30:00+04'
     AND w.last_inbound_at > now() - interval '23 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.outreach_auto_sold_notice() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outreach_auto_sold_notice') THEN PERFORM cron.unschedule('outreach_auto_sold_notice'); END IF;
END $$;
SELECT cron.schedule('outreach_auto_sold_notice', '2-57/5 * * * *', $job$ select crm_repair_private.outreach_auto_sold_notice(); $job$);
