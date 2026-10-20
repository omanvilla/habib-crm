RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY company_id,branch_key,month_start),'[]'::jsonb) FROM crm_repair_private.branch_monthly_targets t)
 =(SELECT value FROM test_branch31 WHERE key='branch_targets_after'),'reapplying after rollback preserves later branch-target edits');
SELECT test_reservation_assert((SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM crm_repair_private.branch_target_history t)
 =(SELECT value FROM test_branch31 WHERE key='goal_history_after'),'reapplication does not duplicate or overwrite target history');
SELECT test_reservation_assert(test_branch31_business()=(SELECT value FROM test_branch31 WHERE key='business_before'),
 'reapplication still preserves all business and original employee-target rows');
SET ROLE authenticated;
SELECT test_reservation_assert((SELECT (m#>>'{goals,inventory}')::int=0 AND (m#>>'{goals,expected_commission}')::numeric=4321.005
 FROM (SELECT test_branch31_metric(crm_branch_target_snapshot(),'muscat')m)t),
 'reapplied branch API reads the saved branch targets rather than recopying outdated employee goals');
RESET ROLE;
SELECT 'SQL31 safe reapplication passed' result;
