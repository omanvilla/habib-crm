-- SQL109 (16 Nov 2026, Ahmed in the daily-plan review: «يوم التسعير ... عدله»): the pricing day moved from Tuesday to
-- Wednesday on 14 Nov (Monday Barka, Tuesday Muscat field day). The WhatsApp alert for a new land study still said
-- «ليوم التسعير (الثلاثاء)». Only that word changes; the body is replaced only if it is still the one read on 16 Nov.
-- Rollback: 109-land-study-wednesday.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $do$
DECLARE def text := pg_get_functiondef('crm_repair_private.property_alerts_run()'::regprocedure);
BEGIN
  IF md5(def) <> '8d5e751d8652b96ffcb6927a6cc5351d' THEN
    RAISE EXCEPTION 'property_alerts_run changed since 16 Nov (md5 %), not replaced', md5(def);
  END IF;
  def := replace(def, 'ليوم التسعير (الثلاثاء)', 'ليوم التسعير (الأربعاء)');
  IF position('ليوم التسعير (الأربعاء)' in def) = 0 THEN
    RAISE EXCEPTION 'text not found';
  END IF;
  EXECUTE def;
END $do$;
