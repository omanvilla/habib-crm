-- Rollback SQL127: job / visa / money chats show in «المشترين الواقفين» again.
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE d text; a text := E'\n       AND NOT crm_repair_private.asks_job_visa_or_money(w.id, w.client_id)';
BEGIN
  d := pg_get_functiondef('public.crm_home_attention()'::regprocedure);
  d := replace(d, a, '');
  EXECUTE d;
END $$;
DROP FUNCTION IF EXISTS crm_repair_private.asks_job_visa_or_money(uuid, uuid);
