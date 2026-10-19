-- Synthetic full catalog ONLY: apply after SQL27 acceptance and before SQL28.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
CREATE TABLE test_coherence28(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_coherence28 TO authenticated;
CREATE FUNCTION test_coherence28_business() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_object_agg(kind,digest) FROM (
 SELECT 'properties' kind,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) digest FROM properties t
 UNION ALL SELECT 'clients',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM clients t
 UNION ALL SELECT 'viewings',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM viewings t
 UNION ALL SELECT 'activities',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM activities t
 UNION ALL SELECT 'deals',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM deals t
 UNION ALL SELECT 'targets',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY employee_id,month_start),'[]'::jsonb)::text) FROM employee_monthly_targets t
 UNION ALL SELECT 'inquiries',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM property_inquiries t
 UNION ALL SELECT 'messages',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM whatsapp_messages t
 UNION ALL SELECT 'conversations',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM whatsapp_conversations t
 UNION ALL SELECT 'attributions',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM property_message_attributions t
 ) s
$$;
CREATE FUNCTION test_coherence28_metric(f date,t date,e uuid DEFAULT test_id(11)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT row FROM jsonb_array_elements(crm_employee_performance(f,t)->'employees')row WHERE row->>'employee_id'=e::text
$$;
CREATE FUNCTION test_coherence28_target(e uuid DEFAULT test_id(11)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT row FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')row WHERE row->>'id'=e::text
$$;
INSERT INTO test_coherence28 VALUES
 ('business_before',test_coherence28_business()),
 ('function_before',to_jsonb(pg_get_functiondef('public.crm_employee_performance(date,date)'::regprocedure))),
 ('view_before',to_jsonb(pg_get_viewdef('public.crm_deals_access'::regclass,true))),
 ('view_acl_before',(SELECT to_jsonb(relacl) FROM pg_class WHERE oid='public.crm_deals_access'::regclass)),
 ('targets_before',crm_employee_target_snapshot()),
 ('performance_before',crm_employee_performance('2026-08-01','2026-11-01'));
INSERT INTO test_coherence28 SELECT 'view_rows_before',coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM crm_deals_access d;
