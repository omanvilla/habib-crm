RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_shared32 WHERE key='business_for_rollback'),
 'reapplying SQL32 preserves every business row created before and after the release');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p)
 =(SELECT value FROM test_shared32 WHERE key='profiles_before'),'reapplying SQL32 does not change any profile');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY company_id,route_key) FROM whatsapp_route_credentials r)
 IS NOT DISTINCT FROM (SELECT value FROM test_shared32 WHERE key='credentials_before'),'reapplying SQL32 never replaces physical credentials');
SELECT test_reservation_assert((SELECT transport_route_key='muscat' AND whatsapp_number IS NULL AND meta_phone_number_id IS NULL
 AND owner_only_inbox IS TRUE AND assigned_to=test_id(10) FROM company_lead_routes WHERE id=test_id(22)),
 'reapply restores the same owner-private logical route through Muscat');
SELECT test_reservation_assert((SELECT before_data-'transport_route_key'=value FROM crm_repair_private.audit32_route_backup,
 LATERAL (SELECT value FROM jsonb_array_elements((SELECT value FROM test_shared32 WHERE key='routes_before')) WHERE value->>'id'=test_id(22)::text)s
 WHERE company_id=test_id(1) AND route_key='investment'),'reapply does not overwrite the original configuration recovery point');
SELECT test_reservation_assert(NOT has_function_privilege('authenticated','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)','EXECUTE'),
 'reapply restores the service-only resolver grants');
SELECT 'SQL32 reapply and retained history passed' result;
