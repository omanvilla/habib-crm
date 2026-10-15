-- Isolated full-catalog snapshot before SQL23: preserve every existing counter,
-- business row, function ownership and ACL.
CREATE TABLE test_performance_clients_catalog AS
 SELECT pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner owner_id
 FROM pg_proc p WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure;
CREATE TABLE test_performance_clients_rows(table_name text,row_id uuid,row_data jsonb);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['clients','client_requests','properties','property_inquiries','whatsapp_messages','whatsapp_conversations','property_message_attributions','company_lead_routes','deals','viewings','activities'] LOOP
  EXECUTE format('INSERT INTO test_performance_clients_rows SELECT %L,id,to_jsonb(x) FROM public.%I x',t,t);
 END LOOP;
END$$;
CREATE TABLE test_performance_clients_before(actor integer PRIMARY KEY,payload jsonb NOT NULL);
GRANT SELECT,INSERT ON test_performance_clients_before TO authenticated;
SET ROLE authenticated;
DO $$DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13,16] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  INSERT INTO test_performance_clients_before VALUES(n,crm_employee_performance(NULL,'2027-01-01'));
 END LOOP;
END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);
