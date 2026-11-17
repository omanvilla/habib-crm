-- Rollback of SQL115: stops the cron and removes the functions. The three sheet_sync_* tables are KEPT (they hold the
-- deal↔row links and the log); dropping them needs Ahmed's explicit yes. The sheets themselves are not touched.
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheet_sync_every_5_min') THEN PERFORM cron.unschedule('sheet_sync_every_5_min'); END IF;
END $$;
UPDATE public.sheet_sync_config SET mode = 'off' WHERE id;
DROP FUNCTION IF EXISTS crm_repair_private.sheet_sync_call(jsonb);
DROP FUNCTION IF EXISTS public.crm_sheet_sync_lease(boolean);
DROP FUNCTION IF EXISTS public.crm_sheet_sync_deals(date);
