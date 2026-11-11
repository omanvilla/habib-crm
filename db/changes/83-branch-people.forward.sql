-- SQL83 (11 Nov 2026, Ahmed: «نعم غيّرها»): targets, performance and tasks show the name of the person on each branch
-- line («مرام» for Barka) instead of the branch name. crm_branch_people() returns, for the Muscat and Barka lines only,
-- the active staff account assigned to the line (company_lead_routes.assigned_to) and its name. Display only: data,
-- targets and attribution stay per branch. No phone or e-mail. Rollback: 83-branch-people.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_branch_people()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('branch', r.route_key, 'name', p.full_name) ORDER BY r.route_key), '[]'::jsonb)
    FROM public.company_lead_routes r
    JOIN public.profiles p ON p.id = r.assigned_to AND p.company_id = r.company_id AND p.is_active AND p.role IN ('manager','agent')
   WHERE r.company_id = public.my_company() AND r.route_key IN ('muscat','barka') AND r.owner_only_inbox IS FALSE
     AND nullif(btrim(p.full_name), '') IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.crm_branch_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_branch_people() TO authenticated;
