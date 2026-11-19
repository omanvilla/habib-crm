-- Rollback of SQL144 (reply audit). Stops the two jobs and drops the functions. The tables are dropped only when empty:
-- once a run wrote rows they are Ahmed's data and stay (ask him before deleting).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('reply_audit_morning','reply_audit_afternoon');
DROP FUNCTION IF EXISTS public.crm_reply_audit_card();
DROP FUNCTION IF EXISTS public.crm_reply_audit_open();
DROP FUNCTION IF EXISTS public.crm_reply_audit_decide(uuid, integer, text, boolean);
DROP FUNCTION IF EXISTS public.crm_reply_audit_apply(uuid[], text, text, text, text);
DROP FUNCTION IF EXISTS public.crm_reply_audit_health(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.crm_reply_audit_unanswered(uuid, timestamptz);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_reply_audit_runs) THEN
    DROP TABLE public.whatsapp_reply_audit_findings; DROP TABLE public.whatsapp_reply_audit_runs;
  END IF;
END $$;
