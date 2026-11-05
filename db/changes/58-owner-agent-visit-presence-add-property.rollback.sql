-- Rollback for SQL58. Publish the front end without these fields first.
DROP FUNCTION IF EXISTS public.crm_add_property_with_owner(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.crm_set_visit_presence(uuid, boolean, text);
ALTER TABLE public.viewings DROP COLUMN IF EXISTS owner_visit_notes, DROP COLUMN IF EXISTS ahmed_present;
UPDATE public.owners SET owner_type = 'owner' WHERE owner_type = 'agent';
ALTER TABLE public.owners DROP COLUMN IF EXISTS has_power_of_attorney, DROP COLUMN IF EXISTS kinship, DROP COLUMN IF EXISTS original_owner_name;
