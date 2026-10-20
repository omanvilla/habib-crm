-- A subsequent independent privilege change must block apply and rollback.
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.crm_branch_monthly_targets(date) TO anon;
