-- SQL79 (11 Nov 2026, Ahmed): Muscat and Barka staff see and work each other's properties, owners, clients,
-- requests, visits, deals and WhatsApp chats, and investors too. Still hidden from staff: the owner's private
-- WhatsApp line (route 'owner') and money (commission/owner_net columns, expenses, reports: unchanged column
-- grants, CASE views and owner-only RPCs). Owner tools (approvals, brain notes, owner home, investment project
-- catalog, Instagram catalog, owner offers) keep their own owner-only policies, untouched here.
--
-- How:
--  * investment_row_allowed (the restrictive policy on 38 tables and the investment write guard) now blocks staff
--    only from the owner's private line (new owner_line_is_private). investment_link_is_private is NOT changed:
--    branch targets, performance and work scopes keep excluding investment exactly as before.
--  * staff_can_access_branch (visibility and write checks) is true for every active staff member on every branch.
--    The old logic lives on as staff_is_branch_member and replaces it inside the functions that use it for the
--    branch's own identity, targets, performance (including commission figures) and daily work lists, so those
--    stay per branch.
--  * can_access_client / can_access_request / can_access_deal_workflow: agents as managers (no assignment needed).
--  * can_access_whatsapp_conversation: staff see every route except the owner line (investment included).
--  * Base policies that limited agents to assigned_to / agent_id now include agents with managers (SELECT/UPDATE
--    only; inserts, deletes, tasks, events and deposits unchanged). crm_deals_access the same (money stays CASE).
--  * Investment write guards accept owner, manager and agent; investment rows stay assigned to the owner.
-- Every replaced function and policy is kept in crm_repair_private.sql79_backup for the rollback.

CREATE TABLE IF NOT EXISTS crm_repair_private.sql79_backup(
  kind text NOT NULL, name text NOT NULL, definition text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,name));
REVOKE ALL ON crm_repair_private.sql79_backup FROM PUBLIC, anon, authenticated;

-- Back up every function this file replaces (first apply only; a re-apply keeps the original).
INSERT INTO crm_repair_private.sql79_backup(kind,name,definition)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN (
   ('crm_repair_private','staff_can_access_branch'),('crm_repair_private','investment_row_allowed'),
   ('crm_repair_private','can_access_client'),('crm_repair_private','can_access_request'),
   ('crm_repair_private','can_access_whatsapp_conversation'),('crm_repair_private','can_access_deal_workflow'),
   ('crm_repair_private','guard_investment_client'),('crm_repair_private','guard_investment_request'),
   ('crm_repair_private','client_first_whatsapp_inbound'),
   ('crm_repair_private','branch_period_metrics'),('crm_repair_private','deal_period_metrics'),
   ('crm_repair_private','crm_dashboard_work_owner'),('public','crm_dashboard_work'),
   ('public','crm_branch_monthly_targets'),('public','crm_branch_performance'),('public','crm_branch_target_snapshot'),
   ('public','crm_client_contact_queue'),('public','crm_employee_performance'),('public','crm_followups_today'))
ON CONFLICT (kind,name) DO NOTHING;
INSERT INTO crm_repair_private.sql79_backup(kind,name,definition)
SELECT 'view','public.crm_deals_access',pg_get_viewdef('public.crm_deals_access'::regclass)
ON CONFLICT (kind,name) DO NOTHING;
INSERT INTO crm_repair_private.sql79_backup(kind,name,definition)
SELECT 'policy', tablename||'.'||policyname, jsonb_build_object('table',tablename,'policy',policyname,'using',qual,'check',with_check)::text
  FROM pg_policies
 WHERE schemaname='public' AND cmd IN ('SELECT','UPDATE')
   AND tablename IN ('clients','client_requests','deals','viewings','appointments','appointment_properties',
                     'property_inquiries','property_rejection_reasons','unmatched_property_links','activities','owners')
ON CONFLICT (kind,name) DO NOTHING;

-- 1. The owner's private line: the only thing staff never see.
CREATE OR REPLACE FUNCTION crm_repair_private.owner_line_is_private(p_company uuid, p_row jsonb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE k text; ident uuid; pair record;
BEGIN
 IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 FOR k IN SELECT unnest(ARRAY['before_data','after_data']) LOOP
  IF jsonb_typeof(p_row->k)='object' AND crm_repair_private.owner_line_is_private(p_company,p_row->k) THEN RETURN true;END IF;
 END LOOP;
 IF p_row->>'entity_type' IN ('conversation','message') THEN
  p_row:=p_row||jsonb_build_object((p_row->>'entity_type')||'_id',p_row->>'entity_id');
 END IF;
 IF p_row->>'route_key'='owner' OR p_row->>'transport_route_key'='owner' THEN RETURN true;END IF;
 IF NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key='owner') THEN RETURN false;END IF;
 FOR pair IN SELECT * FROM (VALUES ('conversation_id'),('source_conversation_id')) AS refs(field_name) LOOP
  IF nullif(p_row->>pair.field_name,'') IS NULL THEN CONTINUE;END IF;
  BEGIN ident:=(p_row->>pair.field_name)::uuid;EXCEPTION WHEN invalid_text_representation THEN CONTINUE;END;
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.id=ident AND c.company_id=p_company AND c.route_key='owner') THEN RETURN true;END IF;
 END LOOP;
 FOR pair IN SELECT * FROM (VALUES ('message_id'),('whatsapp_message_id'),('origin_whatsapp_message_id'),('source_whatsapp_message_id'),('source_message_id')) AS refs(field_name) LOOP
  IF nullif(p_row->>pair.field_name,'') IS NULL THEN CONTINUE;END IF;
  BEGIN ident:=(p_row->>pair.field_name)::uuid;EXCEPTION WHEN invalid_text_representation THEN CONTINUE;END;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages m JOIN public.whatsapp_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
             WHERE m.id=ident AND m.company_id=p_company AND c.route_key='owner') THEN RETURN true;END IF;
 END LOOP;
 RETURN false;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.owner_line_is_private(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.owner_line_is_private(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_row_allowed(p_company uuid, p_row jsonb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE actor_role text;
BEGIN
 SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.company_id=p_company AND p.is_active IS TRUE;
 IF actor_role IS NULL THEN RETURN false;END IF;
 IF actor_role='owner' THEN RETURN true;END IF;
 -- SQL79: investors are visible to staff; only the owner's private line stays owner-only.
 RETURN NOT crm_repair_private.owner_line_is_private(p_company,p_row);
END $function$;

-- 2. Branch membership (identity, targets, performance, daily work) keeps the previous rule.
CREATE OR REPLACE FUNCTION crm_repair_private.staff_is_branch_member(p_company uuid, p_branch text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and (p_branch IS DISTINCT FROM 'investment' OR p.role='owner')
     and (p.role in ('owner','manager','viewer')
       or (p.role='agent' and exists(
         select 1 from public.company_lead_routes r
         where r.company_id=p_company and r.assigned_to=p.id
           and r.route_key=p_branch and r.owner_only_inbox is false)))
  );
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.staff_is_branch_member(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.staff_is_branch_member(uuid,text) TO authenticated;

DO $do$
DECLARE r record; src text; n int:=0;
BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE (ns.nspname,p.proname) IN (
     ('crm_repair_private','branch_period_metrics'),('crm_repair_private','deal_period_metrics'),
     ('crm_repair_private','crm_dashboard_work_owner'),('public','crm_dashboard_work'),
     ('public','crm_branch_monthly_targets'),('public','crm_branch_performance'),('public','crm_branch_target_snapshot'),
     ('public','crm_client_contact_queue'),('public','crm_employee_performance'),('public','crm_followups_today'))
 LOOP
  src:=pg_get_functiondef(r.oid);
  IF position('crm_repair_private.staff_can_access_branch(' in src)=0 THEN CONTINUE;END IF;
  EXECUTE replace(src,'crm_repair_private.staff_can_access_branch(','crm_repair_private.staff_is_branch_member(');
  n:=n+1;
 END LOOP;
 RAISE NOTICE 'SQL79: % functions keep per-branch membership', n;
 -- Client chronology: staff see the investor's real first contact instead of the registration time.
 SELECT p.oid INTO r FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='crm_repair_private' AND p.proname='client_first_whatsapp_inbound';
 src:=pg_get_functiondef(r.oid);
 IF position('NOT crm_repair_private.investment_link_is_private(' in src)>0 THEN
  EXECUTE replace(src,'NOT crm_repair_private.investment_link_is_private(','crm_repair_private.investment_row_allowed(');
 END IF;
END $do$;

-- 3. Visibility and write checks: every branch for every active staff member.
CREATE OR REPLACE FUNCTION crm_repair_private.staff_can_access_branch(p_company uuid, p_branch text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  -- SQL79: Muscat, Barka, investment and general are shared by all staff; the owner line is never a branch.
  RETURN p_branch IS DISTINCT FROM 'owner' AND exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and p.role in ('owner','manager','viewer','agent'));
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(c))
      AND p.role IN ('owner','manager','viewer','agent'));
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(r))
      AND p.role IN ('owner','manager','viewer','agent'));
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_whatsapp_conversation(p_company_id uuid, p_conversation_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN exists(
   select 1 from public.profiles p join public.whatsapp_conversations c
     on c.company_id=p.company_id and c.id=p_conversation_id
   where p.id=(select auth.uid()) and p.is_active and p.company_id=p_company_id
     AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(c))
     and (p.role='owner' or
       (p.role in ('manager','agent') and c.route_key is distinct from 'owner' and exists(
          select 1 from public.company_lead_routes r
          where r.company_id=p_company_id and r.route_key=c.route_key
            and (r.owner_only_inbox is false or r.route_key='investment')))));
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_deal_workflow(p_deal_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.deals d JOIN public.profiles u ON u.company_id=d.company_id
 WHERE d.id=p_deal_id AND u.id=auth.uid() AND u.is_active IS TRUE AND crm_repair_private.investment_row_allowed(d.company_id,to_jsonb(d))
   AND u.role IN ('owner','manager','agent'))
$function$;

-- 4. Investment write guards: staff may add and edit investors; rows stay assigned to the owner.
DO $do$
DECLARE r record; src text;
BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='crm_repair_private' AND p.proname IN ('guard_investment_client','guard_investment_request')
 LOOP
  src:=pg_get_functiondef(r.oid);
  src:=replace(src,'public.my_role() IS DISTINCT FROM ''owner''','coalesce(public.my_role(),'''') NOT IN (''owner'',''manager'',''agent'')');
  src:=replace(src,'AND public.my_role()=''owner'' THEN new.lead_route:=''investment''','AND public.my_role() IN (''owner'',''manager'',''agent'') THEN new.lead_route:=''investment''');
  EXECUTE src;
 END LOOP;
END $do$;

-- 5. Base policies: agents with managers for reading and editing (not insert/delete).
DO $do$
DECLARE r record; q text; w text; stmt text;
BEGIN
 FOR r IN SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND cmd IN ('SELECT','UPDATE')
     AND tablename IN ('clients','client_requests','deals','viewings','appointments','appointment_properties',
                       'property_inquiries','property_rejection_reasons','unmatched_property_links','activities','owners')
     AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'ARRAY\[''owner''::text, ''manager''::text(, ''viewer''::text)?\]'
 LOOP
  q:=regexp_replace(r.qual,'ARRAY\[''owner''::text, ''manager''::text(, ''viewer''::text)?\]','ARRAY[''owner''::text, ''manager''::text\1, ''agent''::text]','g');
  w:=CASE WHEN r.with_check IS NULL THEN NULL ELSE regexp_replace(r.with_check,'ARRAY\[''owner''::text, ''manager''::text(, ''viewer''::text)?\]','ARRAY[''owner''::text, ''manager''::text\1, ''agent''::text]','g') END;
  IF r.tablename='activities' AND r.cmd<>'SELECT' THEN CONTINUE;END IF;
  stmt:=format('ALTER POLICY %I ON public.%I USING (%s)',r.policyname,r.tablename,q);
  IF w IS NOT NULL THEN stmt:=stmt||format(' WITH CHECK (%s)',w);END IF;
  EXECUTE stmt;
 END LOOP;
END $do$;

-- 6. Deals list: every card for staff; commission columns remain CASE owner-only inside the view.
DO $do$
DECLARE v text;
BEGIN
 v:=pg_get_viewdef('public.crm_deals_access'::regclass);
 v:=replace(v,'ARRAY[''owner''::text, ''manager''::text, ''viewer''::text]','ARRAY[''owner''::text, ''manager''::text, ''viewer''::text, ''agent''::text]');
 EXECUTE 'CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS '||v;
END $do$;
