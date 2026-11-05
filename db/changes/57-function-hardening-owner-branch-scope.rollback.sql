-- Rollback for SQL57.
DROP POLICY IF EXISTS owners_select_company ON public.owners;
CREATE POLICY owners_select_company ON public.owners FOR SELECT TO authenticated USING (company_id = (SELECT public.my_company()));
ALTER FUNCTION public.crm_area_token(text) RESET search_path;
ALTER FUNCTION public.crm_client_first_contacts(uuid[]) RESET search_path;
ALTER FUNCTION public.crm_money(numeric) RESET search_path;
ALTER FUNCTION public.crm_owner_kind(text) RESET search_path;
