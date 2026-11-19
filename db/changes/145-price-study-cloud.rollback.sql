-- Rollback of SQL145. Re-run the crm_price_study_unpriced_due block of 141-unpriced-after-run.forward.sql (one alert per
-- task again) and the crm_price_study_documents block of 94-price-study-auto.forward.sql after the DROP below (no
-- drive_file_id column). The Drive copies, the drive_file_id column and the folders table are kept (data, Ahmed decides).
SELECT cron.unschedule('owner_price_study_drive') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_drive');
DROP FUNCTION IF EXISTS public.crm_price_study_drive_due();
DROP FUNCTION IF EXISTS public.crm_price_study_documents(uuid);
