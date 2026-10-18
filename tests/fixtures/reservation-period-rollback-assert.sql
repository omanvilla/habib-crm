DO $$DECLARE b record;BEGIN
 FOR b IN SELECT * FROM crm_repair_private.reservation_release_backup LOOP
  PERFORM test_reservation_assert(pg_get_functiondef(to_regprocedure(b.identity))=b.definition,'original function restored: '||b.identity);
 END LOOP;
 PERFORM test_reservation_assert((SELECT count(*)=2 FROM crm_repair_private.deal_commission_receipts),'rollback preserved actual receipt history');
 PERFORM test_reservation_assert((SELECT count(*)>0 FROM crm_repair_private.deal_milestone_events),'rollback preserved event audit');
END$$;
SELECT 'reservation rollback assertions passed' result;
