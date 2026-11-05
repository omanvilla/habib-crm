-- Rollback for SQL63. To stop sending at once: UPDATE whatsapp_automation_runtime SET visit_followups_auto = false.
SELECT cron.unschedule('habib_visit_followups_auto_send');
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  EXECUTE replace(d, $q$ AND v.auto_confidence IS NOT NULL)$q$, ')');
  d := pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure);
  EXECUTE regexp_replace(d,
    $q$WHERE coalesce\(vw\.archived, false\) = false.*?viewing_date >= \(now\(\) AT TIME ZONE 'Asia/Muscat'\)::date\)\)\)$q$,
    $q$WHERE vw.status = 'done' AND coalesce(vw.archived, false) = false
         AND vw.viewing_date >= greatest(date '2026-11-02', (now() AT TIME ZONE 'Asia/Muscat')::date - 60)$q$);
END
$do$;
UPDATE public.viewings SET created_via = 'system' WHERE created_via = 'whatsapp_ai' AND auto_confidence IS NULL AND source_whatsapp_message_id IS NOT NULL;
ALTER TABLE public.whatsapp_automation_runtime DROP COLUMN IF EXISTS visit_followups_auto;
