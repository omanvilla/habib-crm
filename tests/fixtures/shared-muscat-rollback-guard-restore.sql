RESET ROLE;
SELECT test_reservation_assert(has_function_privilege('anon','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','execute'),
 'guarded apply and rollback retain the independently changed grant');
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_shared32 WHERE key='business_for_rollback'),
 'refused apply and rollback change no business record');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM company_lead_routes r)
 =(SELECT value FROM test_shared32 WHERE key='routes_for_rollback'),'refused apply and rollback change no route configuration');
REVOKE EXECUTE ON FUNCTION public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid) FROM anon;
