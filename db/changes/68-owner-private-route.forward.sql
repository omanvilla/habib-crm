-- SQL68 (6 Nov 2026): a third WhatsApp line, the owner's private number +96890944469.
--
-- * New route_key 'owner' (label «واتساب المالك»). It is its own physical number
--   with its own meta_phone_number_id / meta_waba_id once linked through Meta.
-- * Owner-only everywhere: the route row, its conversations, messages, onboarding
--   events, credentials and anything linking to them are hidden from managers and
--   agents through the existing owner-only isolation (owner_only_inbox +
--   crm_repair_private.investment_link_is_private / investment_row_allowed).
-- * Never classified as investment. Investors keep arriving on the Muscat line;
--   the 'investment' route, a00_guard_investment_route, a01_shared_reception_route
--   and crm_repair_private.resolve_shared_whatsapp_business_route are unchanged.
-- * Private capture only: no CRM client, request, inquiry or reply-agent draft is
--   derived from this line. Messages are stored with client_id/request_id NULL, so
--   every client-based trigger (wake_reply_agent, follow-ups, property links,
--   contact touch) returns early.
-- * The row is seeded inactive. It becomes active only when the owner links it
--   through whatsapp-embedded-signup / whatsapp-direct-bind.
-- No customer, message or auth rows are changed. Rollback: 68-owner-private-route.rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regprocedure('crm_repair_private.investment_link_is_private(uuid,jsonb,text[])') IS NULL
     OR to_regprocedure('crm_repair_private.propagate_private_whatsapp_context()') IS NULL
     OR to_regprocedure('crm_repair_private.investment_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SQL68 apply refused: owner-only isolation helpers are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a01_shared_reception_route'
                   AND tgrelid = 'public.company_lead_routes'::regclass) THEN
    RAISE EXCEPTION 'SQL68 apply refused: shared reception guard is missing';
  END IF;
END $guard$;

-- 1) Allow the new route key where a WhatsApp line is described. CRM records
--    (clients, requests, appointments, properties) deliberately do not get it.
ALTER TABLE public.company_lead_routes DROP CONSTRAINT IF EXISTS company_lead_routes_key_check;
ALTER TABLE public.company_lead_routes ADD CONSTRAINT company_lead_routes_key_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general','owner'])) NOT VALID;
ALTER TABLE public.company_lead_routes VALIDATE CONSTRAINT company_lead_routes_key_check;

ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_route_check;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_route_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general','owner'])) NOT VALID;
ALTER TABLE public.whatsapp_conversations VALIDATE CONSTRAINT whatsapp_conversations_route_check;

ALTER TABLE public.whatsapp_onboarding_events DROP CONSTRAINT IF EXISTS whatsapp_onboarding_events_route_check;
ALTER TABLE public.whatsapp_onboarding_events ADD CONSTRAINT whatsapp_onboarding_events_route_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general','owner'])) NOT VALID;
ALTER TABLE public.whatsapp_onboarding_events VALIDATE CONSTRAINT whatsapp_onboarding_events_route_check;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_owner_route_idx
  ON public.whatsapp_conversations (id) WHERE route_key = 'owner';

-- 2) Route row guard. Runs after a00/a01 (alphabetical), which stay untouched.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_owner_private_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE number_ text := nullif(regexp_replace(coalesce(new.whatsapp_number, ''), '\D', '', 'g'), '');
        phone_id_ text := nullif(btrim(coalesce(new.meta_phone_number_id, '')), '');
BEGIN
  IF TG_OP = 'UPDATE' AND old.route_key IS DISTINCT FROM new.route_key
     AND 'owner' IN (old.route_key, new.route_key) THEN
    RAISE EXCEPTION 'owner_private_route_key_locked' USING ERRCODE = '23514';
  END IF;
  -- One physical number belongs to one route. The owner's private number can
  -- never be bound to Muscat/Barka, and their numbers never to the owner route.
  -- Compared by route_key, not id: an upsert's BEFORE INSERT row has a fresh id.
  IF number_ IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.company_lead_routes r
       WHERE r.company_id = new.company_id AND r.route_key IS DISTINCT FROM new.route_key
         AND 'owner' IN (r.route_key, new.route_key)
         AND regexp_replace(coalesce(r.whatsapp_number, ''), '\D', '', 'g') = number_) THEN
    RAISE EXCEPTION 'owner_private_route_number_in_use' USING ERRCODE = '23514';
  END IF;
  IF phone_id_ IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.company_lead_routes r
       WHERE r.company_id = new.company_id AND r.route_key IS DISTINCT FROM new.route_key
         AND 'owner' IN (r.route_key, new.route_key)
         AND btrim(coalesce(r.meta_phone_number_id, '')) = phone_id_) THEN
    RAISE EXCEPTION 'owner_private_route_number_in_use' USING ERRCODE = '23514';
  END IF;
  IF new.route_key = 'owner' THEN
    IF new.transport_route_key IS NOT NULL THEN
      RAISE EXCEPTION 'owner_private_route_has_own_line' USING ERRCODE = '23514';
    END IF;
    new.owner_only_inbox := true;
    new.channel_type := 'whatsapp';
    new.assigned_to := crm_repair_private.investment_owner(new.company_id);
    IF new.assigned_to IS NULL THEN
      RAISE EXCEPTION 'owner_not_configured' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_owner_private_route() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS a02_owner_private_route ON public.company_lead_routes;
CREATE TRIGGER a02_owner_private_route BEFORE INSERT OR UPDATE ON public.company_lead_routes
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_owner_private_route();

-- 3) Conversation guard: a conversation on the owner's line is always 'owner',
--    owned by the company owner, with no CRM client. It cannot leave the route.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_owner_private_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE line_ boolean;
BEGIN
  SELECT true INTO line_ FROM public.company_lead_routes r
  WHERE r.company_id = new.company_id AND r.route_key = 'owner'
    AND nullif(btrim(coalesce(r.meta_phone_number_id, '')), '') IS NOT NULL
    AND r.meta_phone_number_id = new.meta_phone_number_id;
  IF TG_OP = 'UPDATE' AND old.route_key = 'owner' AND new.route_key IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'owner_private_conversation_locked' USING ERRCODE = '23514';
  END IF;
  IF coalesce(line_, false) OR new.route_key = 'owner' THEN
    IF NOT coalesce(line_, false) AND NOT (TG_OP = 'UPDATE' AND old.route_key = 'owner'
        AND old.meta_phone_number_id IS NOT DISTINCT FROM new.meta_phone_number_id) THEN
      -- 'owner' is only for the owner's linked physical line.
      RAISE EXCEPTION 'owner_private_route_wrong_line' USING ERRCODE = '23514';
    END IF;
    new.route_key := 'owner';
    new.client_id := NULL;
    new.assigned_to := crm_repair_private.investment_owner(new.company_id);
    IF new.assigned_to IS NULL THEN
      RAISE EXCEPTION 'owner_not_configured' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_owner_private_conversation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS a02_owner_private_conversation ON public.whatsapp_conversations;
CREATE TRIGGER a02_owner_private_conversation BEFORE INSERT OR UPDATE OF route_key, assigned_to, client_id, meta_phone_number_id
ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_owner_private_conversation();

-- 4) Message guard: no CRM identity or request on owner-line messages. This keeps
--    wake_reply_agent, follow-up, property-link and contact triggers inactive.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_owner_private_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF (new.client_id IS NOT NULL OR new.request_id IS NOT NULL) AND EXISTS (
       SELECT 1 FROM public.whatsapp_conversations c
       WHERE c.id = new.conversation_id AND c.company_id = new.company_id AND c.route_key = 'owner') THEN
    new.client_id := NULL;
    new.request_id := NULL;
  END IF;
  RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_owner_private_message() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS a00_owner_private_message ON public.whatsapp_messages;
CREATE TRIGGER a00_owner_private_message BEFORE INSERT OR UPDATE OF conversation_id, client_id, request_id
ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_owner_private_message();

-- 5) Reuse the owner-only isolation. Same function as live, plus: a row whose
--    route_key is 'owner', or that points to an owner-line conversation/message,
--    is private. Investment logic and the SQL38 fast path are kept as they were.
CREATE OR REPLACE FUNCTION crm_repair_private.investment_link_is_private(p_company uuid, p_row jsonb, p_seen text[] DEFAULT '{}'::text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
 -- SQL68: the owner's private WhatsApp line is owner-only, like investment.
 IF p_row->>'route_key'='owner' THEN RETURN true;END IF;
 IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key='owner') THEN
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
 END IF;
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
REVOKE ALL ON FUNCTION crm_repair_private.investment_link_is_private(uuid,jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;

-- 6) Classifying a contact as an investor moves that phone's Muscat conversations
--    to 'investment'. It must never pull a conversation off the owner's line.
CREATE OR REPLACE FUNCTION crm_repair_private.propagate_private_whatsapp_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  AND c.route_key IS DISTINCT FROM 'owner'
  AND (coalesce(all_lines_,false) OR c.route_key='investment' OR EXISTS(
   SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=c.company_id
    AND r.route_key='muscat' AND r.is_active IS TRUE AND r.meta_phone_number_id=c.meta_phone_number_id))
  AND (c.route_key IS DISTINCT FROM 'investment' OR c.assigned_to IS DISTINCT FROM owner_);
 RETURN new;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.propagate_private_whatsapp_context() FROM PUBLIC, anon, authenticated, service_role;

-- 7) Seed the route, inactive until the owner links it through Meta.
INSERT INTO public.company_lead_routes (company_id, route_key, label, whatsapp_number, is_active, owner_only_inbox)
SELECT m.company_id, 'owner', 'واتساب المالك', '+96890944469', false, true
FROM public.company_lead_routes m
WHERE m.route_key = 'muscat'
  AND NOT EXISTS (SELECT 1 FROM public.company_lead_routes o WHERE o.company_id = m.company_id AND o.route_key = 'owner');
