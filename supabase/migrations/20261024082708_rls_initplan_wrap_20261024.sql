-- SQL37: evaluate auth.uid()/auth.jwt()/my_company()/my_role() once per query
-- in public RLS policies instead of once per row.
--
-- Each bare call is wrapped as "( SELECT f() )" so Postgres plans it as an
-- InitPlan. The functions are STABLE and take no row input, so the result is
-- identical; only evaluation frequency changes. my_company()/my_role() are
-- SECURITY DEFINER and are never inlined, so they were the larger per-row cost.
-- Resolves the auth_rls_initplan advisor findings (37) and applies the same
-- rewrite to every other public policy using those calls (85 policies total).
-- Row-dependent helpers (crm_repair_private.can_access_client, staff_can_access_branch,
-- investment_row_allowed, is_company_owner(col)) are unchanged.
--
-- Pre-apply trial (rolled back): 28 role/table counts identical for owner and agent.

CREATE TABLE IF NOT EXISTS crm_repair_private.rls37_policy_backup (
  schemaname text NOT NULL,
  tablename text NOT NULL,
  policyname text NOT NULL,
  qual text,
  with_check text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename, policyname)
);
ALTER TABLE crm_repair_private.rls37_policy_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.rls37_policy_backup FROM PUBLIC, anon, authenticated;

INSERT INTO crm_repair_private.rls37_policy_backup (schemaname, tablename, policyname, qual, with_check)
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      ~ '(?<![A-Za-z_.])(?<!SELECT )(auth\.uid|auth\.jwt|my_company|my_role)\(\)'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  pat constant text := '(?<![A-Za-z_.])(?<!SELECT )(auth\.uid|auth\.jwt|my_company|my_role)\(\)';
  pol record;
BEGIN
  FOR pol IN SELECT * FROM crm_repair_private.rls37_policy_backup ORDER BY tablename, policyname LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I%s%s', pol.policyname, pol.schemaname, pol.tablename,
      CASE WHEN pol.qual IS NOT NULL
        THEN ' USING (' || regexp_replace(pol.qual, pat, '( SELECT \1() )', 'g') || ')' ELSE '' END,
      CASE WHEN pol.with_check IS NOT NULL
        THEN ' WITH CHECK (' || regexp_replace(pol.with_check, pat, '( SELECT \1() )', 'g') || ')' ELSE '' END);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ pat
  ) THEN
    RAISE EXCEPTION 'SQL37: unwrapped auth/my_* call remains in a public policy';
  END IF;
END $$;
