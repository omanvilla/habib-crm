-- SQL63 (5 Nov 2026, owner's decision): after a visit the follow-up goes out on its own, without his approval.
-- It also covers visits that passed with no result in the last 30 days, because the reply tells us what happened.
-- Sending stops with visit_followups_auto = false. Only UTILITY templates, or free text inside the 24 hour window.
ALTER TABLE public.whatsapp_automation_runtime ADD COLUMN IF NOT EXISTS visit_followups_auto boolean NOT NULL DEFAULT true;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure);
  n := regexp_replace(d,
    $q$WHERE vw\.status = 'done' AND coalesce\(vw\.archived, false\) = false\s+AND vw\.viewing_date >= greatest\(date '2026-11-02', \(now\(\) AT TIME ZONE 'Asia/Muscat'\)::date - 60\)$q$,
    $q$WHERE coalesce(vw.archived, false) = false
         AND vw.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date - 60
         AND ((vw.status = 'done' AND (vw.viewing_date >= date '2026-11-02' OR vw.created_via = 'system'))
           OR (vw.status IN ('scheduled','confirmed','postponed')
               AND vw.viewing_date < (now() AT TIME ZONE 'Asia/Muscat')::date
               AND vw.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date - 30
               AND NOT EXISTS (SELECT 1 FROM public.viewings nx WHERE nx.client_id = vw.client_id AND coalesce(nx.archived, false) = false
                                 AND nx.status IN ('scheduled','confirmed') AND nx.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date)))$q$);
  IF n = d THEN RAISE EXCEPTION 'followup_queue_filter_not_found'; END IF;
  EXECUTE n;
END
$do$;

-- Visits found in chats act like the visit watch's own: a client who says he did not go, or moves the day, updates them.
-- auto_confidence stays empty, so the home page still waits for the first visit the watch logs by itself.
UPDATE public.viewings SET created_via = 'whatsapp_ai'
 WHERE created_via = 'system' AND source_whatsapp_message_id IS NOT NULL AND auto_confidence IS NULL;
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  n := replace(d, $q$v.company_id = v_company AND v.created_via = 'whatsapp_ai')$q$, $q$v.company_id = v_company AND v.created_via = 'whatsapp_ai' AND v.auto_confidence IS NOT NULL)$q$);
  IF n = d THEN RAISE EXCEPTION 'owner_home_text_not_found'; END IF;
  EXECUTE n;
  d := pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure);
  n := replace(d, $q$vw.created_via = 'system'$q$, $q$(vw.created_via = 'whatsapp_ai' AND vw.auto_confidence IS NULL)$q$);
  IF n = d THEN RAISE EXCEPTION 'followup_queue_via_not_found'; END IF;
  EXECUTE n;
END
$do$;

SELECT cron.schedule('habib_visit_followups_auto_send', '*/15 5-16 * * *', $cron$
  SELECT net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-visit-followup-auto',
    headers := jsonb_build_object('content-type','application/json','x-crm-agent',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);
