-- Rollback of SQL108: the «sent from the phone» record is removed (studies already marked sent stay sent).
SET LOCAL lock_timeout = '10s';
DROP FUNCTION IF EXISTS public.crm_price_study_sent_by_phone(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_drop(uuid, text);
