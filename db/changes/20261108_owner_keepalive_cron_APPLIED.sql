-- 8 Nov 2026 (Ahmed, R8): every 15 minutes check whether the Barka / Muscat window to Ahmed's private number closes within
-- the hour; if so that number writes «هلا» to him (whatsapp-owner-hot-alert action=keepalive). Ahmed answers it and the
-- window stays open for the hot buyer alerts (R7). Events: whatsapp_automation_events action_type=owner_keepalive.
select cron.unschedule('owner_whatsapp_keepalive') where exists (select 1 from cron.job where jobname='owner_whatsapp_keepalive');
select cron.schedule('owner_whatsapp_keepalive', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-agent', (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := '{"action":"keepalive"}'::jsonb, timeout_milliseconds := 30000);
$$);
