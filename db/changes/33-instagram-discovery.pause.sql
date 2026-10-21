-- Operational pause only. Run as database administrator if the feature must stop.
-- Preserve all catalog, audit, marketing and customer history. This is not a destructive schema rollback.
BEGIN;
UPDATE public.instagram_discovery_state SET enabled=false,auto_link_enabled=false,updated_at=now();
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='habib_instagram_media_discovery';
COMMIT;
-- An already in-flight read can finish, but the atomic auto-link transaction rechecks auto_link_enabled.
-- To restore: enable the intended account only, deploy the verified worker, then schedule the same named job.
-- Never reactivate habib_whatsapp_followups_hourly as part of this feature's recovery.
