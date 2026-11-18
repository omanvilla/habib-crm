-- Rollback SQL125: no task closes by itself again. Tasks it already closed stay closed (their notes say «انقفلت تلقائياً»).
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_message ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_call ON public.activities;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_property ON public.properties;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_owner_lead ON public.owner_leads;
DROP FUNCTION IF EXISTS crm_repair_private.autoclose_on_message();
DROP FUNCTION IF EXISTS crm_repair_private.autoclose_on_call();
DROP FUNCTION IF EXISTS crm_repair_private.autoclose_on_property();
DROP FUNCTION IF EXISTS crm_repair_private.autoclose_on_owner_lead();
DROP FUNCTION IF EXISTS crm_repair_private.autoclose_tasks(uuid, uuid, text, text, timestamptz, uuid, uuid);
