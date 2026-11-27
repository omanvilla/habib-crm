-- SQL159 (27 Nov 2026, Ahmed: «عندك الصلاحيه سوي»). Staff could read properties.owner_net and properties.expected_commission
-- straight from the REST API (an agent read 48 rows), although the screen hides them and the masked view
-- crm_properties_access returns them to the owner only. The table now gives authenticated SELECT on every column
-- except those two; the app already reads through crm_properties_access (crmDataFrom), and writes keep their
-- table-level INSERT/UPDATE grants. Same pattern as deals.
-- NOTE for later migrations: a NEW column on properties is not readable by authenticated until it is granted:
--   GRANT SELECT (new_col) ON public.properties TO authenticated;   (the view still shows it, it runs as its owner)
-- Rollback: 159-properties-money-columns-owner-only.rollback.sql
SET LOCAL lock_timeout = '10s';
DO $sql159$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum) INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public.properties'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('owner_net', 'expected_commission');
  REVOKE SELECT ON public.properties FROM authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.properties TO authenticated', cols);
  IF has_column_privilege('authenticated', 'public.properties'::regclass, 'owner_net', 'SELECT')
     OR has_column_privilege('authenticated', 'public.properties'::regclass, 'expected_commission', 'SELECT') THEN
    RAISE EXCEPTION 'SQL159: money columns still readable';
  END IF;
END $sql159$;
