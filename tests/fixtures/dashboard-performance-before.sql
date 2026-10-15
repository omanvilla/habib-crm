-- Isolated full-catalog fixture only: capture regression evidence before SQL20.
CREATE TABLE test_dashboard_performance_before(actor integer PRIMARY KEY,payload jsonb NOT NULL);
GRANT SELECT,INSERT ON test_dashboard_performance_before TO authenticated;
CREATE TABLE test_dashboard_performance_catalog AS
SELECT pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl,p.proowner AS owner_id
FROM pg_proc p WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure;
CREATE TABLE test_dashboard_performance_rows AS
SELECT 'clients'::text AS table_name,id,to_jsonb(x) AS row_data FROM clients x
UNION ALL SELECT 'properties',id,to_jsonb(x) FROM properties x
UNION ALL SELECT 'client_requests',id,to_jsonb(x) FROM client_requests x
UNION ALL SELECT 'deals',id,to_jsonb(x) FROM deals x
UNION ALL SELECT 'viewings',id,to_jsonb(x) FROM viewings x
UNION ALL SELECT 'activities',id,to_jsonb(x) FROM activities x
UNION ALL SELECT 'property_inquiries',id,to_jsonb(x) FROM property_inquiries x
UNION ALL SELECT 'whatsapp_messages',id,to_jsonb(x) FROM whatsapp_messages x;
SET ROLE authenticated;
DO $$DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  INSERT INTO test_dashboard_performance_before VALUES(n,crm_employee_performance(NULL,'2027-01-01'));
 END LOOP;
END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);
