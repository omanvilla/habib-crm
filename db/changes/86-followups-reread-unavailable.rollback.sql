-- Rollback of SQL86 (the follow-up sent back to review is rewritten by the next review run either way).
DROP TRIGGER IF EXISTS crm_followups_reread_on_property_change ON public.properties;
DROP FUNCTION IF EXISTS crm_repair_private.followups_reread_on_property_change();
DROP FUNCTION IF EXISTS crm_repair_private.followups_reread_for_area(uuid, text, text);

-- crm_followups_today without the chat id: re-run db/changes/85-staff-followups-all.forward.sql (its md5 check expects the SQL84-era body, so apply only the CREATE FUNCTION part)
