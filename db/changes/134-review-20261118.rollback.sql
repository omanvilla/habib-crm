-- Rollback of SQL134. Drops what SQL134 added and puts the triggers back on status only.
-- The replaced function bodies come back by re-running their CREATE OR REPLACE FUNCTION blocks from:
--   99  price_study_run_minutes, crm_price_study_unpriced_due
--   124 price_study_open_tasks
--   125 autoclose_on_message
--   122 handoff_close_on_property
--   131 hot_buyer_property_gone
--   129 hot_notification_to_whatsapp
-- (each of those blocks is self-contained; run only the function blocks, not the whole files).
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS crm_hot_notification_copy_to_staff ON public.notifications;
DROP TRIGGER IF EXISTS crm_hot_notification_shared_read ON public.notifications;
DROP TRIGGER IF EXISTS crm_owner_notification_to_whatsapp ON public.notifications;
DROP FUNCTION IF EXISTS crm_repair_private.hot_notification_copy_to_staff();
DROP FUNCTION IF EXISTS crm_repair_private.hot_notification_shared_read();
DROP FUNCTION IF EXISTS crm_repair_private.owner_notification_to_whatsapp();
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'agreement_ending_whatsapp';
DROP FUNCTION IF EXISTS crm_repair_private.agreement_ending_whatsapp();

DROP TRIGGER IF EXISTS crm_handoff_close_on_property ON public.properties;
CREATE TRIGGER crm_handoff_close_on_property AFTER UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.handoff_close_on_property();
DROP TRIGGER IF EXISTS crm_hot_buyer_property_gone ON public.properties;
CREATE TRIGGER crm_hot_buyer_property_gone AFTER UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.hot_buyer_property_gone();
-- the helpers property_is_gone / deal_is_booked and the column properties.utilities_note are harmless and stay
-- (drop them only after the function bodies above are restored).
