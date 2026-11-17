-- Rollback SQL120. Removes the triggers and functions; no data is deleted. «تم» values the triggers wrote stay (they only hide a
-- row from the list). To see them: activities where description like 'تم تلقائي (%' or 'تم (Claude بطلب أحمد)%'.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_handoff_close_on_deal ON public.deals;
DROP TRIGGER IF EXISTS crm_handoff_close_on_property ON public.properties;
DROP TRIGGER IF EXISTS crm_handoff_close_on_call ON public.activities;
DROP TRIGGER IF EXISTS crm_handoff_close_on_meeting_task ON public.tasks;
DROP FUNCTION IF EXISTS crm_repair_private.handoff_close_on_deal();
DROP FUNCTION IF EXISTS crm_repair_private.handoff_close_on_property();
DROP FUNCTION IF EXISTS crm_repair_private.handoff_close_on_call();
DROP FUNCTION IF EXISTS crm_repair_private.handoff_close_on_meeting_task();
DROP FUNCTION IF EXISTS crm_repair_private.close_hot_handoffs(uuid, uuid, text, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.crm_mark_handoff_done(uuid, text);
DROP FUNCTION IF EXISTS public.crm_owner_open_handoffs();
DROP FUNCTION IF EXISTS public.crm_hot_handoff_open(public.whatsapp_conversations);
