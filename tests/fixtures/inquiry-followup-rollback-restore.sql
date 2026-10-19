DO $$ BEGIN EXECUTE (SELECT applied_definition FROM crm_repair_private.audit29_catalog_backup WHERE identity='public.crm_save_inquiry_followup(jsonb,uuid)');END $$;
