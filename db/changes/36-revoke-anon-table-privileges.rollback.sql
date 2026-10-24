-- SQL36 rollback: re-grant exactly the anon table privileges captured before SQL36
-- and restore the postgres default privileges for anon in schema public.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM crm_repair_private.anon36_grants_backup LOOP
    IF to_regclass(format('%I.%I', r.object_schema, r.object_name)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE %I.%I TO anon', r.privilege_type, r.object_schema, r.object_name);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
