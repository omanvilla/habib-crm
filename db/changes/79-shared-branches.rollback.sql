-- Rollback of SQL79: restores every function, policy and the deals view saved in crm_repair_private.sql79_backup
-- (branch separation and owner-only investors as on 10 Nov 2026). Data is not touched by SQL79 or by this file.
DO $do$
DECLARE r record; j jsonb; stmt text;
BEGIN
 FOR r IN SELECT definition FROM crm_repair_private.sql79_backup WHERE kind='function' LOOP
  EXECUTE r.definition;
 END LOOP;
 FOR r IN SELECT definition FROM crm_repair_private.sql79_backup WHERE kind='policy' LOOP
  j:=r.definition::jsonb;
  stmt:=format('ALTER POLICY %I ON public.%I',j->>'policy',j->>'table');
  IF j->>'using' IS NOT NULL THEN stmt:=stmt||format(' USING (%s)',j->>'using');END IF;
  IF j->>'check' IS NOT NULL THEN stmt:=stmt||format(' WITH CHECK (%s)',j->>'check');END IF;
  EXECUTE stmt;
 END LOOP;
 FOR r IN SELECT definition FROM crm_repair_private.sql79_backup WHERE kind='view' AND name='public.crm_deals_access' LOOP
  EXECUTE 'CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS '||r.definition;
 END LOOP;
END $do$;
DROP FUNCTION IF EXISTS crm_repair_private.staff_is_branch_member(uuid,text);
DROP FUNCTION IF EXISTS crm_repair_private.owner_line_is_private(uuid,jsonb);
-- The backup table is kept on purpose (evidence); drop it by hand once the rollback is confirmed.
