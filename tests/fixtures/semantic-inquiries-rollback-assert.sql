DO $$DECLARE saved record;actual jsonb;BEGIN
 PERFORM test_assert(to_regprocedure('public.crm_apply_verified_property_inquiries(uuid,jsonb,boolean)') IS NULL,'semantic write RPC remained after rollback');
 PERFORM test_assert(to_regprocedure('public.crm_property_inquiry_candidates(uuid,integer,integer)') IS NULL,'semantic candidate RPC remained after rollback');
 PERFORM test_assert(to_regprocedure('crm_repair_private.semantic_property_is_private(uuid,uuid)') IS NULL,'semantic private helper remained after rollback');
 PERFORM test_assert((SELECT pg_get_functiondef(p.oid)=b.definition AND p.proacl::text IS NOT DISTINCT FROM b.acl AND p.proowner=b.owner_id
  FROM pg_proc p CROSS JOIN test_semantic_catalog_before b WHERE p.oid='public.refresh_client_request_summary(uuid)'::regprocedure),'client summary rollback did not preserve definition/ACL/owner');
 FOR saved IN SELECT * FROM test_semantic_rows_before LOOP
  EXECUTE format('SELECT to_jsonb(x)-''evidence'' FROM public.%I x WHERE id=$1',saved.table_name) INTO actual USING saved.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM saved.row_data,'semantic release changed existing business data: '||saved.table_name);
 END LOOP;
END$$;
SELECT 'Semantic rollback disabled new writers and restored summary definition/ACL/owner without losing existing records' AS result;
