-- Isolated fixture snapshot: SQL22 must not rewrite business rows or widen ACLs.
CREATE TABLE test_semantic_catalog_before AS SELECT pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner owner_id
 FROM pg_proc p WHERE p.oid='public.refresh_client_request_summary(uuid)'::regprocedure;
CREATE TABLE test_semantic_rows_before(table_name text,row_id uuid,row_data jsonb);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['clients','client_requests','properties','property_inquiries','whatsapp_messages','whatsapp_conversations','property_message_attributions','company_lead_routes'] LOOP
  EXECUTE format('INSERT INTO test_semantic_rows_before SELECT %L,id,to_jsonb(x)-''evidence'' FROM public.%I x',t,t);
 END LOOP;
END$$;
