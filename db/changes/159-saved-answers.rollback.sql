-- Rollback of SQL159. Drops the capture trigger and the RPC; the table is kept (it holds Ahmed's answers).
-- Dropping the table itself needs Ahmed's explicit go (no data is deleted without it).
DROP TRIGGER IF EXISTS crm_a_saved_answer_capture ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.saved_answer_capture();
DROP FUNCTION IF EXISTS public.crm_saved_answer_decide(uuid, text, text, text, text);
