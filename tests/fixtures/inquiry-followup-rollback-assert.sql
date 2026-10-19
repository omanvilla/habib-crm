RESET ROLE;
SELECT test_reservation_assert(to_regprocedure('public.crm_save_inquiry_followup(jsonb,uuid)') IS NULL,'SQL29 rollback removes only the new API');
SELECT test_reservation_assert(pg_get_functiondef('public.sync_request_from_property_inquiry()'::regprocedure)=(SELECT definition FROM crm_repair_private.audit29_catalog_backup WHERE identity='public.sync_request_from_property_inquiry()'),'SQL29 rollback restores the exact predecessor milestone function');
SELECT test_reservation_assert((SELECT value FROM test_followup29 WHERE key='preserve_before_rollback')=jsonb_build_object('inquiries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM property_inquiries q),'activities',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM activities a),'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM client_requests r)),'SQL29 rollback preserves every inquiry, activity audit and request row');
SELECT 'inquiry follow-up rollback assertions passed' result;
