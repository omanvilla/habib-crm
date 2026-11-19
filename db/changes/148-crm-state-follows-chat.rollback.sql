-- Rollback of SQL148: removes the four triggers and their functions and puts the SQL129 WhatsApp trigger back as it was.
-- Rows already changed by SQL148 (visits cancelled, meeting task titles, notifications saved as read) stay as they are.
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS crm_gone_notice_cancels_visits ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.gone_notice_cancels_visits();
DROP TRIGGER IF EXISTS crm_keep_gone_visit_cancelled ON public.viewings;
DROP FUNCTION IF EXISTS crm_repair_private.keep_gone_visit_cancelled();
DROP TRIGGER IF EXISTS crm_no_stale_hot_handoff ON public.whatsapp_conversations;
DROP FUNCTION IF EXISTS crm_repair_private.no_stale_hot_handoff();
DROP TRIGGER IF EXISTS crm_quiet_stale_hot_notification ON public.notifications;
DROP FUNCTION IF EXISTS crm_repair_private.quiet_stale_hot_notification();
DROP TRIGGER IF EXISTS crm_meeting_answered_by_person ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.meeting_answered_by_person();
DROP FUNCTION IF EXISTS public.crm_last_message_by_clients(uuid[]);

DROP TRIGGER IF EXISTS crm_hot_notification_to_whatsapp ON public.notifications;
CREATE TRIGGER crm_hot_notification_to_whatsapp AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (NEW.type = 'whatsapp_handoff' AND coalesce(NEW.title, '') ~ '^(🔥|📞|📅)')
  EXECUTE FUNCTION crm_repair_private.hot_notification_to_whatsapp();
