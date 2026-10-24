-- SQL36: the anon role no longer holds privileges on public tables/views.
-- These were Supabase defaults; RLS already returned zero rows to anon, so this
-- is defense in depth. Nothing in the frontend reads tables before sign-in:
-- invites use Auth sign-up, and the legacy public lead RPCs were already not
-- executable by anon. Edge Functions use the service role and are unaffected.
-- Function EXECUTE grants are out of scope here.

CREATE TABLE IF NOT EXISTS crm_repair_private.anon36_grants_backup (
  object_schema text NOT NULL,
  object_name text NOT NULL,
  privilege_type text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_schema, object_name, privilege_type)
);
ALTER TABLE crm_repair_private.anon36_grants_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.anon36_grants_backup FROM PUBLIC, anon, authenticated;

INSERT INTO crm_repair_private.anon36_grants_backup (object_schema, object_name, privilege_type)
SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public'
ON CONFLICT DO NOTHING;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Stop new tables/sequences created by postgres (all CRM migrations) from
-- re-granting anon. supabase_admin defaults cannot be altered from this role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
