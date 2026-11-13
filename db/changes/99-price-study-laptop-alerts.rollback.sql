-- Rollback of SQL99: the «افتح اللابتوب» alerts stop (the two-hour check and the alert after a rejection). Nothing else was
-- changed by SQL99, so nothing else is put back. The line added to the price study report lives in the edge function
-- whatsapp-owner-hot-alert: re-pin it to fb4849c to remove it, and price-study to 2e3924d.
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_unpriced') THEN PERFORM cron.unschedule('owner_price_study_unpriced'); END IF;
END $$;

DROP TRIGGER IF EXISTS crm_price_study_on_reject ON public.owner_price_studies;
DROP FUNCTION IF EXISTS crm_repair_private.price_study_on_reject();
DROP FUNCTION IF EXISTS public.crm_price_study_requeued(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_unpriced_due();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_brief(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.price_study_run_minutes(timestamptz, timestamptz);
