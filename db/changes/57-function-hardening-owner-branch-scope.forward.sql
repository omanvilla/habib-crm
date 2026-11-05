-- SQL57: audit fixes.
-- Helper functions get a fixed search_path; the outreach trigger function is not callable from the API.
ALTER FUNCTION public.crm_area_token(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_client_first_contacts(uuid[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_money(numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.crm_owner_kind(text) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.crm_queue_property_outreach() FROM PUBLIC, anon, authenticated;
-- A branch account sees only the owners it added or whose property is in its branch (properties RLS decides
-- that); the owner, managers and viewers keep seeing every owner.
DROP POLICY IF EXISTS owners_select_company ON public.owners;
CREATE POLICY owners_select_company ON public.owners FOR SELECT TO authenticated USING (
  company_id = (SELECT public.my_company()) AND (
    (SELECT public.my_role()) IN ('owner','manager','viewer')
    OR added_by = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.properties p WHERE p.owner_id = owners.id)
  )
);
