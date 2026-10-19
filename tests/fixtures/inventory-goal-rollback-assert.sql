-- Synthetic full catalog ONLY. SQL27 rollback preserves every business row.
SELECT test_reservation_assert(to_jsonb(pg_get_functiondef('public.crm_employee_target_snapshot()'::regprocedure))
 =(SELECT value FROM test_inventory27 WHERE key='function_before'),
 'rollback restores the exact preceding SQL26 target function');
SELECT test_reservation_assert(
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM properties p)
 =(SELECT value FROM test_inventory27 WHERE key='properties_after'),
 'rollback leaves original and new synthetic properties and timestamps intact');
SELECT test_reservation_assert(
 (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY employee_id,month_start),'[]'::jsonb) FROM employee_monthly_targets t)
 =(SELECT value FROM test_inventory27 WHERE key='targets_after'),
 'rollback preserves all targets including explicit zero goals');
SELECT test_reservation_assert(
 (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM deals d)
 =(SELECT value FROM test_inventory27 WHERE key='deals_before'),
 'inventory migration and rollback never alter any existing deal');
SELECT 'inventory goal source rollback passed' result;
