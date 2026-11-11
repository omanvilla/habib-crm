-- Rollback of SQL83: the pages fall back to the branch name.
DROP FUNCTION IF EXISTS public.crm_branch_people();
