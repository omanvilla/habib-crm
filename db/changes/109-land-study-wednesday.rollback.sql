-- Rollback of SQL109: the land-study alert says Tuesday again.
SET LOCAL lock_timeout = '10s';

DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.property_alerts_run()'::regprocedure);
BEGIN
  IF position('ليوم التسعير (الأربعاء)' in def) = 0 THEN
    RAISE EXCEPTION 'SQL109 text not present, nothing to roll back';
  END IF;
  EXECUTE replace(def, 'ليوم التسعير (الأربعاء)', 'ليوم التسعير (الثلاثاء)');
END $do$;
