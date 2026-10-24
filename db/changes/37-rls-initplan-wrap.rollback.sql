-- SQL37 rollback: restore each rewritten policy's original USING / WITH CHECK text.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT * FROM crm_repair_private.rls37_policy_backup ORDER BY tablename, policyname LOOP
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = pol.schemaname AND tablename = pol.tablename AND policyname = pol.policyname) THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I%s%s', pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.qual IS NOT NULL THEN ' USING (' || pol.qual || ')' ELSE '' END,
        CASE WHEN pol.with_check IS NOT NULL THEN ' WITH CHECK (' || pol.with_check || ')' ELSE '' END);
    END IF;
  END LOOP;
END $$;
