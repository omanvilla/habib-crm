-- All post-release business values and ledger data survive the executable rollback.
SELECT test_reservation_assert((SELECT amount=1.005 FROM expenses WHERE id=test_id(9690)),'rollback preserves milli OMR expense');
SELECT test_reservation_assert((SELECT agent_share=200 AND company_share=1800.005 FROM deals WHERE id=(SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key='savedA')),'rollback does not recalculate allocations');
SELECT test_reservation_assert((SELECT count(*)=3 AND sum(amount)=4500.005 FROM crm_repair_private.deal_commission_receipts WHERE deal_id IN(SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key IN('savedA','savedB'))),'rollback preserves all actual receipt rows');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.audit26_catalog_backup b WHERE pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.definition),'rollback restores the exact preceding workflow functions');
SELECT 'financial reporting preservation rollback passed' result;
