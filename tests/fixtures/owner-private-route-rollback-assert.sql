-- After 68-owner-private-route.rollback.sql: catalog is back to the pre-SQL68 state.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.company_lead_routes WHERE route_key='owner') THEN RAISE EXCEPTION 'owner route still present'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('a02_owner_private_route','a02_owner_private_conversation','a00_owner_private_message')) THEN
    RAISE EXCEPTION 'owner triggers still present';
  END IF;
  IF to_regprocedure('crm_repair_private.guard_owner_private_route()') IS NOT NULL THEN RAISE EXCEPTION 'owner guard function still present'; END IF;
  IF to_regclass('public.whatsapp_conversations_owner_route_idx') IS NOT NULL THEN RAISE EXCEPTION 'owner index still present'; END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='company_lead_routes_key_check')) LIKE '%owner%' THEN
    RAISE EXCEPTION 'route check still allows owner';
  END IF;
  IF EXISTS (SELECT 1 FROM public.test_sql68_snapshot s JOIN pg_proc p ON 'fn:'||p.proname=s.item
             JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='crm_repair_private'
             WHERE md5(pg_get_functiondef(p.oid)) <> s.value) THEN
    RAISE EXCEPTION 'a replaced function was not restored exactly';
  END IF;
END $$;
\echo SQL68 rollback assertions passed
