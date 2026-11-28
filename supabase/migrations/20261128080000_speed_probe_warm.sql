-- SQL169 (28 Nov 2026, Ahmed «نعم» to the weekly check): crm_db_speed_alert raised every hour from 27 Nov 11:38 Muscat
-- (probe median 2.3 s) while real API requests stayed normal (p50 ~50 ms, p95 ~600 ms, no 500s). The slow part is only the
-- first scan in a fresh cron session; the same scan right after is 7–90 ms. Real CRM requests come over warm pooled
-- connections, so the alert now judges the warm pass. A real CPU starvation (27 Nov 11:09) slows warm queries too
-- (50–100x), so it is still caught. The cold pass is kept in cold_ms for reference.
-- Undo: restore the SQL163 body (single timed pass) and drop column cold_ms.
ALTER TABLE crm_repair_private.db_speed_probes ADD COLUMN IF NOT EXISTS cold_ms numeric;

CREATE OR REPLACE FUNCTION crm_repair_private.db_speed_probe()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t timestamptz; n bigint; cold numeric; ms numeric;
BEGIN
  -- pass 1 (cold: fresh session caches)
  t := clock_timestamp();
  SELECT count(*) INTO n FROM generate_series(1, 200000);
  SELECT count(*) INTO n FROM public.whatsapp_messages WHERE message_type = 'audio';
  cold := round((extract(epoch FROM clock_timestamp() - t) * 1000)::numeric, 1);
  -- pass 2 (warm: what pooled API connections see); this one feeds the alert
  t := clock_timestamp();
  SELECT count(*) INTO n FROM generate_series(1, 200000);
  SELECT count(*) INTO n FROM public.whatsapp_messages WHERE message_type = 'audio';
  ms := round((extract(epoch FROM clock_timestamp() - t) * 1000)::numeric, 1);
  INSERT INTO crm_repair_private.db_speed_probes (ms, connections, cold_ms)
  VALUES (ms, (SELECT count(*) FROM pg_catalog.pg_stat_activity), cold);
  RETURN ms;
END $function$;
