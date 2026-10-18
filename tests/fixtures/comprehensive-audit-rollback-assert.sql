SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.audit25_business_before b JOIN deals d ON b.table_name='deals' AND d.id=b.id WHERE to_jsonb(d)-'reservation_reference' IS DISTINCT FROM b.row_data),'rollback preserves all pre-existing deals');
SELECT test_reservation_assert((SELECT count(*)=2 FROM deals WHERE id IN(SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key IN('savedA','savedB'))),'rollback preserves new bookings');
SELECT test_reservation_assert((SELECT count(*)=3 FROM crm_repair_private.deal_commission_receipts WHERE deal_id IN(SELECT (value->>'deal_id')::uuid FROM test_audit_payload WHERE key IN('savedA','savedB'))),'rollback preserves actual receipts');
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM crm_repair_private.deal_milestone_events WHERE after_data->>'reason'='synthetic verified date correction'),'rollback preserves original/corrected audit history');
SELECT test_reservation_assert((SELECT count(*)=3 FROM activities WHERE id IN(test_id(9450),test_id(9452),test_id(9453))),'rollback preserves documented human activities');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.deals'::regclass AND tgname='crm_require_deposit_reservation'),'rollback removes deferred stage constraint');
SELECT 'audit rollback assertions passed' result;
