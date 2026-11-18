-- Rollback SQL126: the two home lists go (the screen hides them when crm_home_attention is missing). The column
-- waiting_done_at is kept (it holds Ahmed's «تم»); drop it by hand only if the feature is abandoned.
SET LOCAL lock_timeout = '10s';
DROP FUNCTION IF EXISTS public.crm_home_attention();
DROP FUNCTION IF EXISTS public.crm_waiting_buyer_done(uuid);
DROP FUNCTION IF EXISTS public.crm_property_confirm_available(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.is_question(text);
