-- Rollback of SQL74. Revert crm-hot-alerts.js first (it reads the column); «تم» then goes back to this browser only.
DROP FUNCTION IF EXISTS public.crm_hot_alert_done(uuid);
ALTER TABLE public.whatsapp_conversations DROP COLUMN IF EXISTS owner_alert_done_at;
