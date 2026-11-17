-- Rollback of SQL114: removes the two added functions. last_login_at values already written stay (harmless).
SET LOCAL lock_timeout = '10s';
DROP FUNCTION IF EXISTS public.crm_call_next(integer);
DROP FUNCTION IF EXISTS public.crm_mark_seen();
