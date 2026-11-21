-- SQL153 rollback: the functions go; the tables and columns stay (no data is dropped).
DROP FUNCTION IF EXISTS public.crm_property_file_public(text);
DROP FUNCTION IF EXISTS public.crm_property_file_link(uuid, jsonb, text, integer);
DROP FUNCTION IF EXISTS public.crm_build_cost_rates_set(text, numeric, date);
