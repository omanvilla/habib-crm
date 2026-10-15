-- Remove future reconciliation only; never delete truthful inquiry history.
BEGIN;
DROP TRIGGER IF EXISTS reconcile_property_link_after_save ON public.property_marketing_events;
DROP FUNCTION IF EXISTS crm_repair_private.reconcile_property_link_after_save();
DROP FUNCTION IF EXISTS crm_repair_private.reconcile_saved_property_link(uuid,uuid[]);
COMMIT;
