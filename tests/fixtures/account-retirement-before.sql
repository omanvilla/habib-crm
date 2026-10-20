-- ISOLATED full-catalog clone only, after SQL31/32. Auth adapter contains IDs,
-- status and timestamps only; it deliberately contains no credential/token data.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert((SELECT name='SYNTHETIC COMPANY' FROM companies WHERE id=test_id(1))
 AND to_regprocedure('public.crm_branch_target_snapshot()') IS NOT NULL
 AND to_regclass('crm_repair_private.audit32_access_changes') IS NOT NULL,
 'account retirement fixture is the isolated migrated synthetic catalog');
-- Verified live catalog on 2026-10-20: these existing private SELECT/INSERT
-- grants and two RLS policies were omitted from the older SQL18 test export.
-- They are fixture completion, not a new production grant or policy change.
ALTER TABLE crm_repair_private.viewing_save_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crm_repair_private.viewing_save_operations TO authenticated;
GRANT ALL ON crm_repair_private.viewing_save_operations TO service_role;
CREATE POLICY viewing_save_operations_read ON crm_repair_private.viewing_save_operations
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND company_id=(SELECT my_company()));
CREATE POLICY viewing_save_operations_insert ON crm_repair_private.viewing_save_operations
 FOR INSERT TO authenticated WITH CHECK(user_id=(SELECT auth.uid()) AND company_id=(SELECT my_company())
  AND (SELECT my_role())=ANY(ARRAY['owner','manager','agent']));
ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;
ALTER TABLE auth.users ADD COLUMN updated_at timestamptz DEFAULT '2026-01-01 00:00+00';
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
 not_after timestamptz,updated_at timestamptz NOT NULL DEFAULT '2026-01-01 00:00+00');
-- Live Supabase uses varchar user_id here, independently of the uuid session FK.
CREATE TABLE auth.refresh_tokens(id bigint PRIMARY KEY,user_id varchar NOT NULL,revoked boolean,
 session_id uuid REFERENCES auth.sessions(id),updated_at timestamptz NOT NULL DEFAULT '2026-01-01 00:00+00');
INSERT INTO auth.sessions(id,user_id,not_after) VALUES
 (test_id(37001),test_id(11),NULL),
 (test_id(37002),test_id(11),now()+interval '1 day'),
 (test_id(37003),test_id(11),now()-interval '1 day'),
 (test_id(37004),test_id(12),now()+interval '1 day'),
 (test_id(37005),test_id(10),now()+interval '1 day'),
 (test_id(37006),test_id(16),now()+interval '1 day');
INSERT INTO auth.refresh_tokens(id,user_id,revoked,session_id) VALUES
 (37011,test_id(11)::text,NULL,test_id(37001)),
 (37012,test_id(11)::text,false,test_id(37002)),
 (37013,test_id(11)::text,true,test_id(37003)),
 (37014,test_id(12)::text,false,test_id(37004)),
 (37015,test_id(10)::text,false,test_id(37005)),
 (37016,test_id(16)::text,false,test_id(37006));
CREATE TABLE test_retirement32(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT,INSERT,UPDATE ON test_retirement32 TO authenticated;
CREATE FUNCTION test_retirement32_business() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t record;result jsonb:='{}';digest text;
BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname NOT LIKE 'test\_%' ESCAPE '\'
    AND c.relname NOT IN('profiles','company_lead_routes'))
   OR (n.nspname='crm_repair_private' AND c.relname NOT LIKE 'audit%' AND c.relname NOT LIKE 'test\_%' ESCAPE '\'))
  ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)::text) FROM %I.%I t',t.nspname,t.relname) INTO digest;
  result:=result||jsonb_build_object(t.nspname||'.'||t.relname,digest);
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION test_retirement32_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('business',test_retirement32_business(),
  'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM profiles t),
  'routes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM company_lead_routes t),
  'users',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.users t),
  'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.sessions t),
  'refresh',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth.refresh_tokens t),
  'audit',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY operation_key),'[]') FROM crm_repair_private.audit32_access_changes t))
$$;
INSERT INTO test_retirement32 VALUES('before',test_retirement32_state());
SET ROLE authenticated;
INSERT INTO test_retirement32 VALUES('performance_before',crm_branch_performance('2026-01-01','2026-02-01')),
 ('snapshot_before',crm_branch_target_snapshot());
RESET ROLE;
SELECT set_config('crm.retirement.company_id',test_id(1)::text,false),
 set_config('crm.retirement.target_user_id',test_id(11)::text,false),
 set_config('crm.retirement.owner_id',test_id(10)::text,false),
 set_config('crm.retirement.retained_user_id',test_id(12)::text,false),
 set_config('crm.retirement.operation_key','synthetic-muscat-retirement-20261020',false);
