-- Rollback SQL159: give authenticated table-level SELECT on properties again (the money columns become readable by staff).
SET LOCAL lock_timeout = '10s';
GRANT SELECT ON public.properties TO authenticated;
