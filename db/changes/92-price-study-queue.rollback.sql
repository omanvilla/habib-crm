-- Rollback of SQL92: stop the price study tick (queued reports then wait until a new report or a manual tick sends them).
SELECT cron.unschedule('owner_price_study_tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_tick');
