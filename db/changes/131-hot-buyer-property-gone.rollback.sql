-- Rollback SQL131: a sold / reserved property no longer clears the serious-buyer notifications. The one notification marked
-- read at Ahmed's word stays read.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_hot_buyer_property_gone ON public.properties;
DROP FUNCTION IF EXISTS crm_repair_private.hot_buyer_property_gone();
