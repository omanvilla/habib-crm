-- Rollback SQL142: the AI may save a visit on a reserved / sold property again.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_aa_skip_ai_viewing_on_gone_property ON public.viewings;
DROP FUNCTION IF EXISTS crm_repair_private.skip_ai_viewing_on_gone_property();
