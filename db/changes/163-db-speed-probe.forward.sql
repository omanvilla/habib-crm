-- SQL163 (27 Nov 2026, Ahmed: «نعم»): free watch on database slowness.
--   On 27 Nov 11:09-11:18 Muscat the small free-plan server choked: the same queries ran 50-100x slower
--   than a few minutes later and ~15% of page requests hit the 8 s statement timeout. The functions are fast
--   when the server is calm, so the watch measures the server itself, not one page.
--   crm_repair_private.db_speed_probe() runs a fixed small workload (200k-row CPU count + one scan of
--   whatsapp_messages, normally ~50-80 ms) every 10 minutes and stores the time in crm_repair_private.db_speed_probes,
--   with the number of open connections (~144 tiny rows a day, no pruning: a DELETE in the body made the Supabase
--   connector ask for a confirmation nobody could answer).
--   crm_repair_private.db_speed_summary(hours) gives probes / median / slow count / slow times (Muscat).
--   No page reads it, nothing is sent to anybody.
-- Rollback: 163-db-speed-probe.rollback.sql

CREATE TABLE IF NOT EXISTS crm_repair_private.db_speed_probes (
  id bigserial PRIMARY KEY,
  probed_at timestamptz NOT NULL DEFAULT now(),
  ms numeric NOT NULL,
  connections int
);
CREATE INDEX IF NOT EXISTS db_speed_probes_at_idx ON crm_repair_private.db_speed_probes (probed_at);

CREATE OR REPLACE FUNCTION crm_repair_private.db_speed_probe()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE t timestamptz := clock_timestamp(); n bigint; ms numeric;
BEGIN
  SELECT count(*) INTO n FROM generate_series(1, 200000);
  SELECT count(*) INTO n FROM public.whatsapp_messages WHERE message_type = 'audio';
  ms := round((extract(epoch FROM clock_timestamp() - t) * 1000)::numeric, 1);
  INSERT INTO crm_repair_private.db_speed_probes (ms, connections)
  VALUES (ms, (SELECT count(*) FROM pg_catalog.pg_stat_activity));
  RETURN ms;
END $function$;

-- Slow = over 1 s (about 15x normal). Times in Muscat.
CREATE OR REPLACE FUNCTION crm_repair_private.db_speed_summary(p_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'probes', count(*),
    'median_ms', percentile_cont(0.5) WITHIN GROUP (ORDER BY ms),
    'slow', count(*) FILTER (WHERE ms > 1000),
    'worst_ms', max(ms),
    'worst_at_muscat', (array_agg(to_char(probed_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') ORDER BY ms DESC))[1],
    'slow_times_muscat', coalesce((array_agg(to_char(probed_at AT TIME ZONE 'Asia/Muscat', 'HH24:MI') ORDER BY probed_at) FILTER (WHERE ms > 1000))[1:12], '{}')
  )
  FROM crm_repair_private.db_speed_probes
  WHERE probed_at > now() - make_interval(hours => p_hours);
$function$;
REVOKE EXECUTE ON FUNCTION crm_repair_private.db_speed_probe(), crm_repair_private.db_speed_summary(int) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('crm_db_speed_probe', '6-56/10 * * * *', 'select crm_repair_private.db_speed_probe()');

-- Alert without touching any scheduled task prompt: crm_db_speed_alert (hourly at :09) FAILS on purpose when 3+ probes
-- in the last hour were over 1 s (or no probe ran). A failed cron already shows up in the morning summary (step 3,
-- fails_24h) and in the reply audit's system health (crm_reply_audit_health, WhatsApp 7:30 / 14:30) with this Arabic text.
CREATE OR REPLACE FUNCTION crm_repair_private.db_speed_check()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE s jsonb := crm_repair_private.db_speed_summary(1);
BEGIN
  IF coalesce((s->>'probes')::int, 0) = 0 THEN
    RAISE EXCEPTION 'منبّه سرعة قاعدة البيانات ما سجّل أي قياس آخر ساعة';
  END IF;
  IF (s->>'slow')::int >= 3 THEN
    RAISE EXCEPTION 'قاعدة البيانات اختنقت: % قياس فوق ثانية آخر ساعة (مسقط: %)، أسوأ % ms', s->>'slow', s->'slow_times_muscat', s->>'worst_ms';
  END IF;
  RETURN 'ok ' || (s->>'median_ms');
END $function$;
REVOKE EXECUTE ON FUNCTION crm_repair_private.db_speed_check() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('crm_db_speed_alert', '9 * * * *', 'select crm_repair_private.db_speed_check()');
