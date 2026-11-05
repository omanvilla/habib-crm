-- Synthetic catalog for SQL68. The functions, triggers and policies below are
-- copied from the live catalog on 5 Nov 2026 (read-only inspection). Tables carry
-- only the columns these objects use. Every row is TEST data; nothing is real.
\set ON_ERROR_STOP on
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE SCHEMA crm_repair_private;
GRANT USAGE ON SCHEMA crm_repair_private TO authenticated, service_role;

CREATE TABLE public.companies (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid NOT NULL, role text NOT NULL, is_active boolean, phone text);
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, phone text, phone_normalized text, lead_route text, assigned_to uuid);
CREATE TABLE public.client_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, client_id uuid, route_key text, branch_key text);
CREATE TABLE public.properties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_key text);
CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_key text);
CREATE TABLE public.deals (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.deposits (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.viewings (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.property_inquiries (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.tasks (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.events (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.instagram_conversations (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.instagram_messages (id uuid PRIMARY KEY, company_id uuid);
CREATE TABLE public.property_marketing_events (id uuid PRIMARY KEY, company_id uuid);

CREATE TABLE public.company_lead_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, route_key text NOT NULL, label text NOT NULL,
  assigned_to uuid, whatsapp_number text, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  meta_phone_number_id text, channel_type text NOT NULL DEFAULT 'whatsapp', owner_only_inbox boolean NOT NULL DEFAULT false,
  meta_waba_id text, meta_login_configuration_id text, transport_route_key text,
  CONSTRAINT company_lead_routes_company_id_route_key_key UNIQUE (company_id, route_key),
  CONSTRAINT company_lead_routes_key_check CHECK (route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));
CREATE UNIQUE INDEX company_lead_routes_meta_phone_uidx ON public.company_lead_routes (company_id, meta_phone_number_id) WHERE meta_phone_number_id IS NOT NULL AND is_active = true;
CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, client_id uuid, route_key text NOT NULL, assigned_to uuid,
  meta_phone_number_id text NOT NULL, inbound_number text, customer_wa_id text, customer_phone text, customer_name text,
  status text DEFAULT 'open', unread_count int DEFAULT 0,
  CONSTRAINT whatsapp_conversations_company_id_meta_phone_number_id_cust_key UNIQUE (company_id, meta_phone_number_id, customer_wa_id),
  CONSTRAINT whatsapp_conversations_route_check CHECK (route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, conversation_id uuid NOT NULL, client_id uuid, request_id uuid,
  whatsapp_message_id text, direction text, body text);
CREATE TABLE public.whatsapp_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, route_key text NOT NULL, status text NOT NULL DEFAULT 'started',
  CONSTRAINT whatsapp_onboarding_events_route_check CHECK (route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));
CREATE TABLE public.whatsapp_route_credentials (company_id uuid NOT NULL, route_key text NOT NULL, PRIMARY KEY (company_id, route_key));
CREATE TABLE public.activities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, client_id uuid, activity_text text, after_data jsonb);

CREATE OR REPLACE FUNCTION public.my_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT p.company_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $function$;
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $function$;
CREATE OR REPLACE FUNCTION public.normalize_crm_phone(p_phone text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE v_input text; v_digits text;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone)='' THEN RETURN NULL; END IF;
  v_input:=translate(btrim(p_phone),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
  v_input:=regexp_replace(v_input,'[[:space:]().-]','','g');
  IF v_input !~ '^\+?[0-9]+$' THEN RETURN NULL; END IF;
  v_digits:=ltrim(v_input,'+');
  IF v_digits LIKE '00%' THEN v_digits:=substr(v_digits,3); END IF;
  IF length(v_digits)=8 THEN v_digits:='968'||v_digits; END IF;
  IF length(v_digits)<7 OR length(v_digits)>15 OR v_digits !~ '^[1-9][0-9]+$' THEN RETURN NULL; END IF;
  IF v_digits LIKE '968%' AND length(v_digits)<>11 THEN RETURN NULL; END IF;
  RETURN '+'||v_digits;
END;
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_owner(p_company uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT p.id FROM public.profiles p WHERE p.company_id=p_company AND p.role='owner' AND p.is_active IS TRUE
 ORDER BY (p.id=(SELECT auth.uid())) DESC,
 EXISTS(SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=p_company AND r.route_key='investment' AND r.assigned_to=p.id) DESC,p.id LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_link_is_private(p_company uuid, p_row jsonb, p_seen text[] DEFAULT '{}'::text[])
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE k text; target_table text; ident uuid; marker text; linked jsonb; pair record;
BEGIN
 IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 FOR k IN SELECT unnest(ARRAY['before_data','after_data']) LOOP
  IF jsonb_typeof(p_row->k)='object' AND crm_repair_private.investment_link_is_private(p_company,p_row->k,p_seen) THEN RETURN true;END IF;
 END LOOP;
 IF p_row->>'entity_type' IN ('client','request','deal','deposit','viewing','appointment','property','conversation','message','task','event','inquiry','property_inquiry') THEN
  p_row:=p_row||jsonb_build_object((p_row->>'entity_type')||'_id',p_row->>'entity_id');
 END IF;
 IF p_row->>'lead_route'='investment' OR p_row->>'route_key'='investment' OR p_row->>'branch_key'='investment' THEN RETURN true;END IF;
 -- SQL38: no linked row can carry an investment marker, so no link can make this row private.
 IF NOT (EXISTS (SELECT 1 FROM public.clients WHERE lead_route='investment')
      OR EXISTS (SELECT 1 FROM public.client_requests WHERE route_key='investment' OR branch_key='investment')
      OR EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key='investment')
      OR EXISTS (SELECT 1 FROM public.properties WHERE branch_key='investment')
      OR EXISTS (SELECT 1 FROM public.appointments WHERE branch_key='investment')) THEN
  RETURN false;
 END IF;
 FOR pair IN SELECT * FROM (VALUES
  ('client_id','clients'),('owner_client_id','clients'),('request_id','client_requests'),('crm_request_id','client_requests'),
  ('deal_id','deals'),('deposit_id','deposits'),('viewing_id','viewings'),('appointment_id','appointments'),('property_inquiry_id','property_inquiries'),('inquiry_id','property_inquiries'),('task_id','tasks'),('event_id','events'),
  ('conversation_id','whatsapp_conversations'),('conversation_id','instagram_conversations'),
  ('source_conversation_id','whatsapp_conversations'),('message_id','whatsapp_messages'),('whatsapp_message_id','whatsapp_messages'),
  ('origin_whatsapp_message_id','whatsapp_messages'),('source_whatsapp_message_id','whatsapp_messages'),('source_message_id','whatsapp_messages'),('message_id','instagram_messages'),('property_id','properties'),('subject_property_id','properties'),('matched_property_id','properties'),('marketing_event_id','property_marketing_events'),('matched_marketing_event_id','property_marketing_events')
 ) AS refs(field_name,table_name)
 LOOP
  IF nullif(p_row->>pair.field_name,'') IS NULL THEN CONTINUE;END IF;
  BEGIN ident:=(p_row->>pair.field_name)::uuid;EXCEPTION WHEN invalid_text_representation THEN CONTINUE;END;
  marker:=pair.table_name||':'||ident::text;
  IF marker=ANY(p_seen) THEN CONTINUE;END IF;
  -- Table names come solely from the fixed VALUES list, never user input.
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id=$1 AND t.company_id=$2',pair.table_name) INTO linked USING ident,p_company;
  IF linked IS NOT NULL AND crm_repair_private.investment_link_is_private(p_company,linked,p_seen||marker) THEN RETURN true;END IF;
 END LOOP;
 RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_row_allowed(p_company uuid, p_row jsonb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE actor_role text;
BEGIN
 SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.company_id=p_company AND p.is_active IS TRUE;
 IF actor_role IS NULL THEN RETURN false;END IF;
 IF actor_role='owner' THEN RETURN true;END IF;
 RETURN NOT crm_repair_private.investment_link_is_private(p_company,p_row);
END $function$;

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
   (p.role='manager' and exists(select 1 from public.company_lead_routes r
      where r.company_id=p_company_id and r.route_key=c.route_key and r.owner_only_inbox is false))
   or (p.role='agent' and exists(select 1 from public.company_lead_routes r
      where r.company_id=p_company_id and r.route_key=c.route_key
        and r.assigned_to=p.id and r.owner_only_inbox is false)))
 );
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_route()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF new.route_key='investment' THEN
  new.owner_only_inbox:=true;new.assigned_to:=crm_repair_private.investment_owner(new.company_id);
  IF new.assigned_to IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
 END IF;
 RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_reception_route()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF new.route_key='investment' THEN
  IF nullif(btrim(new.whatsapp_number),'') IS NOT NULL OR nullif(btrim(new.meta_phone_number_id),'') IS NOT NULL
   OR nullif(btrim(new.meta_waba_id),'') IS NOT NULL OR nullif(btrim(new.meta_login_configuration_id),'') IS NOT NULL
   OR (new.transport_route_key IS NOT NULL AND new.transport_route_key<>'muscat') THEN
   RAISE EXCEPTION 'investment_uses_muscat_line' USING ERRCODE='23514';
  END IF;
  new.transport_route_key:='muscat';new.owner_only_inbox:=true;
  new.assigned_to:=crm_repair_private.investment_owner(new.company_id);
  IF new.assigned_to IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
 ELSIF new.transport_route_key IS NOT NULL THEN
  RAISE EXCEPTION 'ordinary_route_cannot_alias_another_branch' USING ERRCODE='23514';
 END IF;
 RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.resolve_shared_whatsapp_business_route(p_company_id uuid, p_physical_route_key text, p_customer_phone text, p_existing_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE physical public.company_lead_routes%ROWTYPE;existing public.whatsapp_conversations%ROWTYPE;
 phone_ text;private_ boolean:=false;owner_ uuid;assignee_ uuid;
BEGIN
 phone_:=public.normalize_crm_phone(p_customer_phone);
 IF p_company_id IS NULL OR phone_ IS NULL OR p_physical_route_key NOT IN('muscat','barka','general') THEN
  RAISE EXCEPTION 'whatsapp_business_route_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO physical FROM public.company_lead_routes r
 WHERE r.company_id=p_company_id AND r.route_key=p_physical_route_key AND r.is_active IS TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_receiving_route_unavailable' USING ERRCODE='23514';END IF;
 IF p_existing_conversation_id IS NOT NULL THEN
  SELECT * INTO existing FROM public.whatsapp_conversations c
  WHERE c.id=p_existing_conversation_id AND c.company_id=p_company_id
   AND public.normalize_crm_phone(coalesce(nullif(btrim(c.customer_phone),''),c.customer_wa_id))=phone_;
  IF NOT FOUND OR (nullif(physical.meta_phone_number_id,'') IS NOT NULL
    AND existing.meta_phone_number_id IS DISTINCT FROM physical.meta_phone_number_id) THEN
   RAISE EXCEPTION 'whatsapp_conversation_context_mismatch' USING ERRCODE='22023';
  END IF;
  private_:=existing.route_key='investment';
 END IF;
 private_:=coalesce(private_,false) OR EXISTS(
  SELECT 1 FROM public.clients c WHERE c.company_id=p_company_id
   AND coalesce(c.phone_normalized,public.normalize_crm_phone(c.phone))=phone_
   AND (c.lead_route='investment' OR (p_physical_route_key='muscat' AND EXISTS(
    SELECT 1 FROM public.client_requests r WHERE r.company_id=c.company_id AND r.client_id=c.id
     AND (r.route_key='investment' OR r.branch_key='investment')))));
 IF private_ THEN
  owner_:=crm_repair_private.investment_owner(p_company_id);
  IF owner_ IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('route_key','investment','assigned_to',owner_,
   'owner_only_inbox',true,'transport_route_key',p_physical_route_key);
 END IF;
 SELECT p.id INTO assignee_ FROM public.profiles p
 WHERE p.id=physical.assigned_to AND p.company_id=p_company_id AND p.is_active IS TRUE;
 RETURN jsonb_build_object('route_key',p_physical_route_key,'assigned_to',assignee_,
  'owner_only_inbox',physical.owner_only_inbox,'transport_route_key',p_physical_route_key);
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_whatsapp_conversation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE physical_ text;resolved_ jsonb;existing_ uuid;phone_ text;private_ boolean;
BEGIN
 phone_:=public.normalize_crm_phone(coalesce(nullif(btrim(new.customer_phone),''),new.customer_wa_id));
 IF TG_OP='INSERT' AND phone_ IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||phone_,32));
 END IF;
 private_:=new.route_key='investment' OR (TG_OP='UPDATE' AND old.route_key='investment');
 IF NOT coalesce(private_,false) THEN
  SELECT r.route_key INTO physical_ FROM public.company_lead_routes r WHERE r.company_id=new.company_id
   AND r.meta_phone_number_id=new.meta_phone_number_id AND r.is_active IS TRUE AND r.route_key IN('muscat','barka','general');
  IF physical_ IS NOT NULL AND phone_ IS NOT NULL THEN
   existing_:=CASE WHEN TG_OP='UPDATE' THEN old.id ELSE NULL END;
   resolved_:=crm_repair_private.resolve_shared_whatsapp_business_route(new.company_id,physical_,phone_,existing_);
   private_:=resolved_->>'route_key'='investment';
  END IF;
 END IF;
 IF coalesce(private_,false) THEN
  new.route_key:='investment';new.assigned_to:=crm_repair_private.investment_owner(new.company_id);
  IF new.assigned_to IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
 END IF;
 RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.propagate_private_whatsapp_context()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE phone_ text;all_lines_ boolean:=false;owner_ uuid;
BEGIN
 IF TG_TABLE_NAME='clients' THEN
  IF new.lead_route IS DISTINCT FROM 'investment' THEN RETURN new;END IF;
  phone_:=coalesce(new.phone_normalized,public.normalize_crm_phone(new.phone));all_lines_:=true;
 ELSIF TG_TABLE_NAME='client_requests' THEN
  IF new.route_key IS DISTINCT FROM 'investment' AND new.branch_key IS DISTINCT FROM 'investment' THEN RETURN new;END IF;
  SELECT coalesce(c.phone_normalized,public.normalize_crm_phone(c.phone)),c.lead_route='investment'
  INTO phone_,all_lines_ FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id;
 ELSE RAISE EXCEPTION 'unexpected_private_context_table';
 END IF;
 IF phone_ IS NULL THEN RETURN new;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||phone_,32));
 owner_:=crm_repair_private.investment_owner(new.company_id);
 IF owner_ IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
 -- Only future explicit classification, in its transaction. No historical
 -- migration sweep, changed message contents or guessed legacy investor flags.
 UPDATE public.whatsapp_conversations c SET route_key='investment',assigned_to=owner_
 WHERE c.company_id=new.company_id
  AND public.normalize_crm_phone(coalesce(nullif(btrim(c.customer_phone),''),c.customer_wa_id))=phone_
  AND (coalesce(all_lines_,false) OR c.route_key='investment' OR EXISTS(
   SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=c.company_id
    AND r.route_key='muscat' AND r.is_active IS TRUE AND r.meta_phone_number_id=c.meta_phone_number_id))
  AND (c.route_key IS DISTINCT FROM 'investment' OR c.assigned_to IS DISTINCT FROM owner_);
 RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_linked_write()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE row_data jsonb;company uuid;
BEGIN
 IF auth.uid() IS NULL THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP IN('UPDATE','DELETE') THEN
  row_data:=to_jsonb(old);company:=coalesce(nullif(row_data->>'company_id','')::uuid,public.my_company());
  IF NOT crm_repair_private.investment_row_allowed(company,row_data) THEN RAISE EXCEPTION 'investment_owner_only' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP IN('INSERT','UPDATE') THEN
  row_data:=to_jsonb(new);company:=coalesce(nullif(row_data->>'company_id','')::uuid,public.my_company());
  IF NOT crm_repair_private.investment_row_allowed(company,row_data) THEN RAISE EXCEPTION 'investment_owner_only' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;
END $function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_repair_private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_repair_private.investment_row_allowed(uuid,jsonb), crm_repair_private.can_access_whatsapp_conversation(uuid,uuid) TO authenticated;

CREATE TRIGGER a00_guard_investment_route BEFORE INSERT OR UPDATE ON public.company_lead_routes FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_route();
CREATE TRIGGER a01_shared_reception_route BEFORE INSERT OR UPDATE ON public.company_lead_routes FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_reception_route();
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR DELETE OR UPDATE ON public.company_lead_routes FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE TRIGGER a01_shared_whatsapp_conversation BEFORE INSERT OR UPDATE OF route_key, assigned_to, client_id, meta_phone_number_id, customer_phone, customer_wa_id ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_whatsapp_conversation();
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR DELETE OR UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR DELETE OR UPDATE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE TRIGGER z01_private_whatsapp_context AFTER INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION crm_repair_private.propagate_private_whatsapp_context();

ALTER TABLE public.company_lead_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_route_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY investment_owner_only ON public.company_lead_routes AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(company_lead_routes.*))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(company_lead_routes.*)));
CREATE POLICY lead_routes_owner_manage ON public.company_lead_routes FOR ALL TO authenticated USING ((company_id = (SELECT my_company())) AND ((SELECT my_role()) = 'owner')) WITH CHECK ((company_id = (SELECT my_company())) AND ((SELECT my_role()) = 'owner'));
CREATE POLICY lead_routes_select_company ON public.company_lead_routes FOR SELECT TO authenticated USING ((company_id = (SELECT my_company())) AND ((SELECT my_role()) = ANY (ARRAY['owner','manager'])));
CREATE POLICY investment_owner_only ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_conversations.*))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_conversations.*)));
CREATE POLICY whatsapp_conversations_select_by_role ON public.whatsapp_conversations FOR SELECT TO authenticated USING (crm_repair_private.can_access_whatsapp_conversation(company_id, id));
CREATE POLICY investment_owner_only ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_messages.*))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_messages.*)));
CREATE POLICY whatsapp_messages_select_by_role ON public.whatsapp_messages FOR SELECT TO authenticated USING (crm_repair_private.can_access_whatsapp_conversation(company_id, conversation_id));
CREATE POLICY investment_owner_only ON public.whatsapp_onboarding_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_onboarding_events.*))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_onboarding_events.*)));
CREATE POLICY whatsapp_onboarding_events_select ON public.whatsapp_onboarding_events FOR SELECT TO authenticated USING ((company_id = (SELECT my_company())) AND ((SELECT my_role()) = ANY (ARRAY['owner','manager'])));
CREATE POLICY investment_owner_only ON public.whatsapp_route_credentials AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(whatsapp_route_credentials.*)));
CREATE POLICY investment_owner_only ON public.activities AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(activities.*))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(activities.*)));
CREATE POLICY activities_select_allowed ON public.activities FOR SELECT TO authenticated USING ((company_id = (SELECT my_company())) AND ((SELECT my_role()) = ANY (ARRAY['owner','manager','viewer','agent'])));
CREATE POLICY activities_insert_staff ON public.activities FOR INSERT TO authenticated WITH CHECK (company_id = (SELECT my_company()));
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE ALL ON public.whatsapp_route_credentials FROM authenticated;

-- Synthetic company: owner, Muscat manager, Barka agent, Muscat/Barka/investment/general routes.
INSERT INTO public.companies VALUES ('00000000-0000-4000-8000-0000000000c1');
INSERT INTO public.profiles VALUES
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000c1','owner',true,'+96800000009'),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000c1','manager',true,null),
 ('00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000c1','agent',true,null);
INSERT INTO public.company_lead_routes (company_id,route_key,label,assigned_to,whatsapp_number,meta_phone_number_id,meta_waba_id) VALUES
 ('00000000-0000-4000-8000-0000000000c1','muscat','مسقط','00000000-0000-4000-8000-0000000000a2','+96800000001','TEST-PNID-MUSCAT','TEST-WABA'),
 ('00000000-0000-4000-8000-0000000000c1','barka','بركاء','00000000-0000-4000-8000-0000000000a3','+96800000002','TEST-PNID-BARKA','TEST-WABA'),
 ('00000000-0000-4000-8000-0000000000c1','general','عام',null,null,null,null);
INSERT INTO public.company_lead_routes (company_id,route_key,label,transport_route_key,owner_only_inbox) VALUES
 ('00000000-0000-4000-8000-0000000000c1','investment','المستثمرون عبر مسقط','muscat',true);
INSERT INTO public.whatsapp_conversations (id,company_id,route_key,assigned_to,meta_phone_number_id,customer_wa_id,customer_phone) VALUES
 ('00000000-0000-4000-8000-00000000d001','00000000-0000-4000-8000-0000000000c1','muscat','00000000-0000-4000-8000-0000000000a2','TEST-PNID-MUSCAT','96811110001','+96811110001');

-- Snapshots compared after forward and rollback.
CREATE TABLE public.test_sql68_snapshot AS
SELECT 'investment_route'::text AS item, (to_jsonb(r) - 'updated_at')::text AS value FROM public.company_lead_routes r WHERE r.route_key='investment'
UNION ALL SELECT 'fn:'||p.proname, md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='crm_repair_private' AND p.proname IN ('investment_link_is_private','propagate_private_whatsapp_context','guard_shared_reception_route','guard_investment_route','resolve_shared_whatsapp_business_route','guard_shared_whatsapp_conversation');
