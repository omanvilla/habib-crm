-- Rollback SQL129: «طلب اتصال» leaves the handoff alert, CRM-only hot notifications stop going to WhatsApp.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_hot_notification_to_whatsapp ON public.notifications;
DROP FUNCTION IF EXISTS crm_repair_private.hot_notification_to_whatsapp();
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('crm_repair_private.owner_hot_alert()'::regprocedure);
  d := replace(d, '^\s*(مشتري جاد|تفاوض|اجتماع|طلب اتصال)\s*:', '^\s*(مشتري جاد|تفاوض|اجتماع)\s*:');
  EXECUTE d;
END $$;
