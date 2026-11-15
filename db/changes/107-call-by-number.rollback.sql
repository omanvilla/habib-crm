-- Rollback of SQL107: the call by number and the agent's lookup are removed (calls already logged stay in activities).
SET LOCAL lock_timeout = '10s';
DROP FUNCTION IF EXISTS public.crm_staff_called(uuid, text);
DROP FUNCTION IF EXISTS public.crm_log_call_number(text, text, text, text, text, text, uuid);
