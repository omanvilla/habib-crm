RESET ROLE;
SELECT test_reservation_assert(has_function_privilege('anon','public.crm_branch_monthly_targets(date)','execute'),
 'guarded apply/rollback refuses to erase an independently changed grant');
REVOKE EXECUTE ON FUNCTION public.crm_branch_monthly_targets(date) FROM anon;
