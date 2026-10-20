RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_coherence28_business()=(SELECT value FROM test_shared32 WHERE key='business_for_rollback'),
 'SQL32 rollback preserves original and post-release clients, requests, conversations, messages, activities and financial records exactly');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p)
 =(SELECT value FROM test_shared32 WHERE key='profiles_before'),'rollback neither reactivates nor modifies any login profile');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM company_lead_routes r)
 =(SELECT value FROM test_shared32 WHERE key='routes_before'),'rollback restores every original route field and timestamp exactly');
SELECT test_reservation_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY company_id,route_key) FROM whatsapp_route_credentials r)
 IS NOT DISTINCT FROM (SELECT value FROM test_shared32 WHERE key='credentials_before'),'rollback preserves physical and historical encrypted credentials exactly');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.company_lead_routes'::regclass
 AND attname='transport_route_key' AND NOT attisdropped),'rollback removes only its added transport column');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.audit32_catalog_backup b WHERE b.kind='function'
 AND to_regprocedure(b.identity) IS NOT NULL),'rollback removes only its new RPC and trigger helper functions');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM crm_repair_private.audit32_catalog_backup b JOIN pg_trigger t
 ON t.tgrelid=to_regclass(split_part(b.identity,':',1)) AND t.tgname=split_part(b.identity,':',2)
 WHERE b.kind='trigger'),'rollback removes only its new shared reception triggers');
SELECT test_reservation_assert((SELECT bool_and(c.relrowsecurity AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
 AND NOT has_table_privilege('anon',c.oid,'SELECT') AND NOT has_table_privilege('service_role',c.oid,'SELECT'))
 FROM pg_class c WHERE c.oid IN('crm_repair_private.audit32_catalog_backup'::regclass,
 'crm_repair_private.audit32_route_backup'::regclass,'crm_repair_private.audit32_access_changes'::regclass)),
 'rollback retains restricted recovery and account-retirement journals without exposing their contents');
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(39400))
 AND NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(39401))
 AND NOT EXISTS(SELECT 1 FROM activities WHERE id=test_id(39401)),
 'compatible prior private RLS still conceals post-release shared-line history after rollback');
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT 'SQL32 non-destructive rollback passed' result;
