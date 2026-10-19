-- Synthetic full catalog ONLY. Run after SQL26 acceptance, before SQL27.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_inventory27(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_inventory27 TO authenticated;
INSERT INTO test_inventory27 VALUES
 ('function_before',to_jsonb(pg_get_functiondef('public.crm_employee_target_snapshot()'::regprocedure))),
 ('snapshot_before',crm_employee_target_snapshot());
INSERT INTO test_inventory27 SELECT 'properties_before',coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM properties p;
INSERT INTO test_inventory27 SELECT 'targets_before',coalesce(jsonb_agg(to_jsonb(t) ORDER BY employee_id,month_start),'[]'::jsonb) FROM employee_monthly_targets t;
INSERT INTO test_inventory27 SELECT 'deals_before',coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM deals d;
