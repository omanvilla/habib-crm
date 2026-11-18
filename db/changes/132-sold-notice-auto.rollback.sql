-- Rollback SQL132: the visit candidates ask about reserved / sold properties again; sold notices wait for Ahmed again.
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outreach_auto_sold_notice') THEN PERFORM cron.unschedule('outreach_auto_sold_notice'); END IF;
END $$;
DROP FUNCTION IF EXISTS crm_repair_private.outreach_auto_sold_notice();
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.crm_visit_confirm_candidates()'::regprocedure);
  d := replace(d, E'\n     -- SQL132: never for a property that is sold or reserved\n     AND coalesce(p.status, ''available'') NOT IN (''sold'', ''reserved'')', '');
  EXECUTE d;
  d := pg_get_functiondef('public.crm_fast_visit_candidates()'::regprocedure);
  d := replace(d, E'\n       -- SQL132: a visit that never happened because the property went is not asked about\n       AND NOT (vw.status <> ''done'' AND EXISTS (SELECT 1 FROM public.properties px WHERE px.id = vw.property_id AND px.status IN (''sold'', ''reserved'')))', '');
  EXECUTE d;
END $$;
