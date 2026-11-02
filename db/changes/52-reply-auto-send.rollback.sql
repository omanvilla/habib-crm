-- Rollback for SQL52. Without the column the agent treats every category as off.
DROP FUNCTION IF EXISTS public.crm_reply_auto_send_get();
DROP FUNCTION IF EXISTS public.crm_reply_auto_send_set(text[]);
ALTER TABLE public.whatsapp_automation_runtime DROP CONSTRAINT IF EXISTS runtime_auto_send_categories_chk;
ALTER TABLE public.whatsapp_automation_runtime DROP COLUMN IF EXISTS auto_send_categories;
