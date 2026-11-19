-- Rollback of SQL146: re-run the crm_price_study_sent_by_phone block of the SQL108 forward file and the
-- crm_price_studies_pending block of the SQL104 forward file, then:
DROP TRIGGER IF EXISTS crm_price_study_on_echo ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.price_study_on_echo();
DROP TABLE IF EXISTS public.crm_service_settings; -- only after asking Ahmed (it holds the Drive uploader key)
