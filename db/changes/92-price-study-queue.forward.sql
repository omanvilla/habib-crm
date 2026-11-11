-- SQL92 (11 Nov 2026, Ahmed): price study reports reach his WhatsApp one client at a time, in order, at least 2 minutes
-- apart. The function queues every report; this job runs its tick every minute (it sends the next one only when the gap
-- has passed and nothing is being sent). The trigger is unchanged. Rollback: 92-price-study-queue.rollback.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_tick') THEN
    PERFORM cron.unschedule('owner_price_study_tick');
  END IF;
END $$;
SELECT cron.schedule('owner_price_study_tick', '* * * * *', $job$
  select net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-agent', (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := '{"action":"price_study_tick"}'::jsonb, timeout_milliseconds := 150000);
$job$);
