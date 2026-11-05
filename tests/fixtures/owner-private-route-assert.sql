-- SQL68 acceptance on the synthetic catalog. Runs as superuser, switching to the
-- authenticated role with JWT claims for each actor, like the live rehearsals.
\set ON_ERROR_STOP on
\set C '''00000000-0000-4000-8000-0000000000c1'''
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_id IS NULL THEN '' ELSE json_build_object('sub',p_id,'role','authenticated')::text END, false);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) > 0 OR SQLSTATE = p_code THEN RETURN; END IF;
    RAISE EXCEPTION 'expected % but got %: %', p_code, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'expected % but statement succeeded: %', p_code, p_sql;
END $$;

-- 1) Seeded route: inactive, owner-only, assigned to the owner, own number.
DO $$ DECLARE r public.company_lead_routes%ROWTYPE; BEGIN
  SELECT * INTO r FROM public.company_lead_routes WHERE route_key='owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'owner route not seeded'; END IF;
  IF r.is_active OR NOT r.owner_only_inbox OR r.assigned_to <> '00000000-0000-4000-8000-0000000000a1'
     OR r.whatsapp_number <> '+96890944469' OR r.label <> 'واتساب المالك' OR r.transport_route_key IS NOT NULL
     OR r.meta_phone_number_id IS NOT NULL THEN
    RAISE EXCEPTION 'owner route seed wrong: %', to_jsonb(r);
  END IF;
END $$;

-- 2) Investment design unchanged: row identical, guard functions identical,
--    and it still refuses its own number / Meta identity.
DO $$ BEGIN
  IF (SELECT value FROM public.test_sql68_snapshot WHERE item='investment_route')
     IS DISTINCT FROM (SELECT (to_jsonb(r) - 'updated_at')::text FROM public.company_lead_routes r WHERE route_key='investment') THEN
    RAISE EXCEPTION 'investment route row changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.test_sql68_snapshot s JOIN pg_proc p ON 'fn:'||p.proname=s.item
             JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='crm_repair_private'
             WHERE p.proname IN ('guard_shared_reception_route','guard_investment_route','resolve_shared_whatsapp_business_route','guard_shared_whatsapp_conversation')
               AND md5(pg_get_functiondef(p.oid)) <> s.value) THEN
    RAISE EXCEPTION 'an investment guard function changed';
  END IF;
END $$;
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET whatsapp_number='+96890944469' WHERE route_key='investment'$$, 'investment_uses_muscat_line');
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET meta_phone_number_id='TEST-PNID-OWNER' WHERE route_key='investment'$$, 'investment_uses_muscat_line');
UPDATE public.company_lead_routes SET transport_route_key=NULL WHERE route_key='investment';
DO $$ BEGIN
  IF (SELECT transport_route_key FROM public.company_lead_routes WHERE route_key='investment') <> 'muscat' THEN
    RAISE EXCEPTION 'investment transport changed';
  END IF;
END $$;

-- 3) One physical number per route, in both directions; owner route cannot alias.
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET whatsapp_number='+96800000001' WHERE route_key='owner'$$, 'owner_private_route_number_in_use');
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET meta_phone_number_id='TEST-PNID-MUSCAT' WHERE route_key='owner'$$, 'owner_private_route_number_in_use');
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET whatsapp_number='+96890944469' WHERE route_key='muscat'$$, 'owner_private_route_number_in_use');
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET transport_route_key='muscat' WHERE route_key='owner'$$, 'ordinary_route_cannot_alias_another_branch');
SELECT pg_temp.expect_error($$UPDATE public.company_lead_routes SET route_key='general' WHERE route_key='owner'$$, 'owner_private_route_key_locked');
UPDATE public.company_lead_routes SET assigned_to='00000000-0000-4000-8000-0000000000a2', owner_only_inbox=false WHERE route_key='owner';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.company_lead_routes WHERE route_key='owner'
             AND (assigned_to <> '00000000-0000-4000-8000-0000000000a1' OR NOT owner_only_inbox)) THEN
    RAISE EXCEPTION 'owner route lost owner-only assignment';
  END IF;
END $$;

-- 3b) The routes page saves every route with one upsert (as the owner); it must keep working.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
SET ROLE authenticated;
INSERT INTO public.company_lead_routes (company_id,route_key,label,assigned_to,whatsapp_number,is_active,transport_route_key) VALUES
 ('00000000-0000-4000-8000-0000000000c1','muscat','مسقط','00000000-0000-4000-8000-0000000000a2','+96800000001',true,null),
 ('00000000-0000-4000-8000-0000000000c1','owner','واتساب المالك','00000000-0000-4000-8000-0000000000a1','+96890944469',false,null)
ON CONFLICT (company_id,route_key) DO UPDATE SET label=excluded.label,assigned_to=excluded.assigned_to,whatsapp_number=excluded.whatsapp_number,is_active=excluded.is_active,transport_route_key=excluded.transport_route_key;
RESET ROLE;
SELECT pg_temp.as_user(NULL);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.company_lead_routes WHERE route_key='owner') <> 1 THEN RAISE EXCEPTION 'owner route duplicated by upsert'; END IF;
END $$;

-- 4) Owner-line conversations before the line is linked are refused.
SELECT pg_temp.expect_error($$INSERT INTO public.whatsapp_conversations(company_id,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
  VALUES ('00000000-0000-4000-8000-0000000000c1','owner','TEST-PNID-MUSCAT','96811110009','+96811110009')$$, 'owner_private_route_wrong_line');

-- 5) Link the line (what embedded signup / direct bind write, as service role).
UPDATE public.company_lead_routes SET meta_phone_number_id='TEST-PNID-OWNER', meta_waba_id='TEST-WABA-OWNER', is_active=true WHERE route_key='owner';

-- 6) A conversation on the owner line is always 'owner', owner-assigned, with no CRM client.
INSERT INTO public.clients(id,company_id,phone,lead_route) VALUES ('00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-0000000000c1','+96811110002','muscat');
INSERT INTO public.whatsapp_conversations (id,company_id,route_key,assigned_to,client_id,meta_phone_number_id,customer_wa_id,customer_phone) VALUES
 ('00000000-0000-4000-8000-00000000d0a1','00000000-0000-4000-8000-0000000000c1','muscat','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-00000000c101','TEST-PNID-OWNER','96811110002','+96811110002'),
 ('00000000-0000-4000-8000-00000000d002','00000000-0000-4000-8000-0000000000c1','muscat','00000000-0000-4000-8000-0000000000a2',null,'TEST-PNID-MUSCAT','96811110002','+96811110002'),
 ('00000000-0000-4000-8000-00000000d003','00000000-0000-4000-8000-0000000000c1','barka','00000000-0000-4000-8000-0000000000a3',null,'TEST-PNID-BARKA','96811110003','+96811110003');
DO $$ DECLARE c public.whatsapp_conversations%ROWTYPE; BEGIN
  SELECT * INTO c FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d0a1';
  IF c.route_key <> 'owner' OR c.client_id IS NOT NULL OR c.assigned_to <> '00000000-0000-4000-8000-0000000000a1' THEN
    RAISE EXCEPTION 'owner-line conversation not forced private: %', to_jsonb(c);
  END IF;
END $$;
SELECT pg_temp.expect_error($$INSERT INTO public.whatsapp_conversations(company_id,route_key,meta_phone_number_id,customer_wa_id,customer_phone)
  VALUES ('00000000-0000-4000-8000-0000000000c1','owner','TEST-PNID-BARKA','96811110008','+96811110008')$$, 'owner_private_route_wrong_line');
SELECT pg_temp.expect_error($$UPDATE public.whatsapp_conversations SET route_key='investment' WHERE id='00000000-0000-4000-8000-00000000d0a1'$$, 'owner_private_conversation_locked');
UPDATE public.whatsapp_conversations SET client_id='00000000-0000-4000-8000-00000000c101' WHERE id='00000000-0000-4000-8000-00000000d0a1';
DO $$ BEGIN
  IF (SELECT client_id FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d0a1') IS NOT NULL THEN
    RAISE EXCEPTION 'owner-line conversation accepted a CRM client';
  END IF;
END $$;

-- 7) Messages on the owner line carry no client or request.
INSERT INTO public.whatsapp_messages (id,company_id,conversation_id,client_id,request_id,whatsapp_message_id,direction,body) VALUES
 ('00000000-0000-4000-8000-00000000e0a1','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000d0a1','00000000-0000-4000-8000-00000000c101',gen_random_uuid(),'wamid.TEST-owner-1','inbound','TEST private'),
 ('00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000d002','00000000-0000-4000-8000-00000000c101',null,'wamid.TEST-muscat-1','inbound','TEST muscat'),
 ('00000000-0000-4000-8000-00000000e003','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000d003',null,null,'wamid.TEST-barka-1','inbound','TEST barka');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e0a1' AND (client_id IS NOT NULL OR request_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'owner-line message kept a CRM client/request';
  END IF;
  IF (SELECT client_id FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e002') IS NULL THEN
    RAISE EXCEPTION 'ordinary Muscat message lost its client';
  END IF;
END $$;
INSERT INTO public.whatsapp_onboarding_events (company_id,route_key,status) VALUES ('00000000-0000-4000-8000-0000000000c1','owner','completed'),('00000000-0000-4000-8000-0000000000c1','muscat','completed');
INSERT INTO public.activities (company_id,activity_text,after_data) VALUES
 ('00000000-0000-4000-8000-0000000000c1','TEST owner line linked','{"route_key":"owner"}'),
 ('00000000-0000-4000-8000-0000000000c1','TEST owner message','{"conversation_id":"00000000-0000-4000-8000-00000000d0a1","message_id":"00000000-0000-4000-8000-00000000e0a1"}'),
 ('00000000-0000-4000-8000-0000000000c1','TEST muscat message','{"conversation_id":"00000000-0000-4000-8000-00000000d002"}');

-- 8) Staff cannot read anything of the owner line; ordinary branch visibility stays.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
SET ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key='owner') THEN RAISE EXCEPTION 'manager sees owner conversation'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e0a1') THEN RAISE EXCEPTION 'manager sees owner message'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_lead_routes WHERE route_key='owner') THEN RAISE EXCEPTION 'manager sees owner route row'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_onboarding_events WHERE route_key='owner') THEN RAISE EXCEPTION 'manager sees owner onboarding'; END IF;
  IF EXISTS (SELECT 1 FROM public.activities WHERE activity_text LIKE 'TEST owner%') THEN RAISE EXCEPTION 'manager sees owner activity'; END IF;
  IF crm_repair_private.can_access_whatsapp_conversation('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000d0a1') THEN RAISE EXCEPTION 'manager passes conversation gate'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d002') THEN RAISE EXCEPTION 'manager lost Muscat conversation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e002') THEN RAISE EXCEPTION 'manager lost Muscat message'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activities WHERE activity_text='TEST muscat message') THEN RAISE EXCEPTION 'manager lost ordinary activity'; END IF;
  IF (SELECT count(*) FROM public.company_lead_routes WHERE route_key IN ('muscat','barka','general')) <> 3 THEN RAISE EXCEPTION 'manager lost ordinary routes'; END IF;
END $$;
SELECT pg_temp.expect_error($$INSERT INTO public.whatsapp_messages (company_id,conversation_id,direction,body) VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000d0a1','outbound','TEST')$$, '42501');
SELECT pg_temp.expect_error($$INSERT INTO public.activities (company_id,activity_text,after_data) VALUES ('00000000-0000-4000-8000-0000000000c1','TEST','{"conversation_id":"00000000-0000-4000-8000-00000000d0a1"}')$$, '42501');
DO $$ DECLARE n int; BEGIN
  UPDATE public.whatsapp_conversations SET unread_count=0 WHERE id='00000000-0000-4000-8000-00000000d0a1';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION 'manager updated owner conversation'; END IF;
END $$;
RESET ROLE;

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
SET ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key='owner') THEN RAISE EXCEPTION 'agent sees owner conversation'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e0a1') THEN RAISE EXCEPTION 'agent sees owner message'; END IF;
  IF EXISTS (SELECT 1 FROM public.activities WHERE activity_text LIKE 'TEST owner%') THEN RAISE EXCEPTION 'agent sees owner activity'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d003') THEN RAISE EXCEPTION 'Barka agent lost Barka conversation'; END IF;
END $$;
RESET ROLE;

-- 9) The owner still sees everything.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
SET ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.whatsapp_conversations) <> 4 THEN RAISE EXCEPTION 'owner does not see all conversations'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e0a1') THEN RAISE EXCEPTION 'owner cannot read owner message'; END IF;
  IF (SELECT count(*) FROM public.company_lead_routes) <> 5 THEN RAISE EXCEPTION 'owner does not see all routes'; END IF;
  IF (SELECT count(*) FROM public.activities WHERE activity_text LIKE 'TEST owner%') <> 2 THEN RAISE EXCEPTION 'owner cannot read owner activities'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- 10) Investor classification moves the Muscat conversation, never the owner line.
UPDATE public.clients SET lead_route='investment' WHERE id='00000000-0000-4000-8000-00000000c101';
DO $$ BEGIN
  IF (SELECT route_key FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d002') <> 'investment' THEN
    RAISE EXCEPTION 'investment propagation stopped working';
  END IF;
  IF (SELECT route_key FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d0a1') <> 'owner' THEN
    RAISE EXCEPTION 'owner-line conversation was auto-classified as investment';
  END IF;
END $$;
-- With investment markers present (slow path) the owner line stays private for staff.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
SET ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id='00000000-0000-4000-8000-00000000e0a1') THEN RAISE EXCEPTION 'manager sees owner message on slow path'; END IF;
  IF EXISTS (SELECT 1 FROM public.activities WHERE activity_text LIKE 'TEST owner%') THEN RAISE EXCEPTION 'manager sees owner activity on slow path'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE id='00000000-0000-4000-8000-00000000d002') THEN RAISE EXCEPTION 'manager sees investment conversation'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- 11) Rollback refuses while owner-line data exists (checked by the runner), then
--     the synthetic rows are removed so the rollback can be exercised.
\echo SQL68 forward assertions passed
