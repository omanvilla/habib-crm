-- SQL32: one physical Muscat number, separate owner-private investment context.
-- No customer/message/auth rows are changed by this migration. The failed
-- independent investment route configuration is preserved privately before
-- becoming a logical alias. Account deactivation is a separately audited action.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE IF NOT EXISTS crm_repair_private.audit32_catalog_backup(
 identity text PRIMARY KEY,kind text NOT NULL,definition text,acl aclitem[],owner_id oid,
 applied_definition text,applied_acl aclitem[],applied_owner_id oid,
 captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_repair_private.audit32_route_backup(
 company_id uuid NOT NULL,route_key text NOT NULL,before_data jsonb NOT NULL,
 applied_data jsonb,captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,route_key)
);
CREATE TABLE IF NOT EXISTS crm_repair_private.audit32_access_changes(
 operation_key text PRIMARY KEY,company_id uuid NOT NULL,target_user_id uuid NOT NULL,
 before_data jsonb NOT NULL,after_data jsonb NOT NULL,actor_id uuid NOT NULL,
 reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.audit32_catalog_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_repair_private.audit32_route_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_repair_private.audit32_access_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit32_catalog_backup,crm_repair_private.audit32_route_backup,
 crm_repair_private.audit32_access_changes FROM PUBLIC,anon,authenticated,service_role;

DO $guard$
DECLARE ident text;def text;acl_ aclitem[];owner_ oid;b record;rel text;trig text;
BEGIN
 FOREACH ident IN ARRAY ARRAY[
  'crm_repair_private.resolve_shared_whatsapp_business_route(uuid,text,text,uuid)',
  'public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)',
  'crm_repair_private.guard_shared_reception_route()',
  'crm_repair_private.guard_shared_whatsapp_conversation()',
  'crm_repair_private.guard_shared_whatsapp_message()',
  'crm_repair_private.validate_shared_whatsapp_request(uuid,uuid,uuid,uuid)',
  'crm_repair_private.guard_shared_whatsapp_request_link()',
  'crm_repair_private.propagate_private_whatsapp_context()'
 ] LOOP
  SELECT pg_get_functiondef(p.oid),p.proacl,p.proowner INTO def,acl_,owner_
  FROM pg_proc p WHERE p.oid=to_regprocedure(ident);
  SELECT * INTO b FROM crm_repair_private.audit32_catalog_backup WHERE identity=ident;
  IF FOUND THEN
   IF NOT ((def IS NOT DISTINCT FROM b.definition AND acl_ IS NOT DISTINCT FROM b.acl AND owner_ IS NOT DISTINCT FROM b.owner_id)
    OR (def IS NOT DISTINCT FROM b.applied_definition AND acl_ IS NOT DISTINCT FROM b.applied_acl AND owner_ IS NOT DISTINCT FROM b.applied_owner_id)) THEN
    RAISE EXCEPTION 'SQL32 apply refused: function or permissions changed since release';
   END IF;
  ELSIF def IS NOT NULL THEN RAISE EXCEPTION 'SQL32 apply refused: unexpected existing function';
  END IF;
  INSERT INTO crm_repair_private.audit32_catalog_backup(identity,kind,definition,acl,owner_id)
  VALUES(ident,'function',def,acl_,owner_) ON CONFLICT DO NOTHING;
 END LOOP;
 FOR rel,trig IN SELECT * FROM (VALUES
  ('company_lead_routes','a01_shared_reception_route'),
  ('whatsapp_conversations','a01_shared_whatsapp_conversation'),
  ('whatsapp_messages','a01_shared_whatsapp_message'),
  ('whatsapp_message_requests','a01_shared_whatsapp_request_link'),
  ('clients','z01_private_whatsapp_context'),
  ('client_requests','z01_private_whatsapp_context')) x(r,t)
 LOOP
  ident:='public.'||rel||':'||trig;
  SELECT pg_get_triggerdef(t.oid) INTO def FROM pg_trigger t
  WHERE t.tgrelid=to_regclass('public.'||rel) AND t.tgname=trig;
  IF EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||rel) AND t.tgname=trig AND t.tgenabled<>'O') THEN
   RAISE EXCEPTION 'SQL32 apply refused: trigger enablement changed since release';
  END IF;
  SELECT * INTO b FROM crm_repair_private.audit32_catalog_backup WHERE identity=ident;
  IF FOUND THEN
   IF def IS DISTINCT FROM b.definition AND def IS DISTINCT FROM b.applied_definition THEN
    RAISE EXCEPTION 'SQL32 apply refused: trigger changed since release';
   END IF;
  ELSIF def IS NOT NULL THEN RAISE EXCEPTION 'SQL32 apply refused: unexpected existing trigger';
  END IF;
  INSERT INTO crm_repair_private.audit32_catalog_backup(identity,kind,definition)
  VALUES(ident,'trigger',def) ON CONFLICT DO NOTHING;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.company_lead_routes'::regclass AND attname='transport_route_key' AND NOT attisdropped)
  AND NOT EXISTS(SELECT 1 FROM crm_repair_private.audit32_catalog_backup WHERE identity='public.company_lead_routes.transport_route_key') THEN
  RAISE EXCEPTION 'SQL32 apply refused: unexpected transport column';
 END IF;
 INSERT INTO crm_repair_private.audit32_catalog_backup(identity,kind,definition)
 VALUES('public.company_lead_routes.transport_route_key','column',NULL) ON CONFLICT DO NOTHING;
END $guard$;

ALTER TABLE public.company_lead_routes ADD COLUMN IF NOT EXISTS transport_route_key text;
DO $column_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.company_lead_routes'::regclass
  AND a.attname='transport_route_key' AND a.atttypid='text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef AND NOT a.attisdropped) THEN
  RAISE EXCEPTION 'SQL32 apply refused: transport column shape changed';
 END IF;
END $column_guard$;

-- A connected independent investment number needs an explicit transition; never
-- clear live provider IDs as an incidental schema upgrade.
DO $route_guard$
DECLARE r record;b record;
BEGIN
 FOR r IN SELECT * FROM public.company_lead_routes WHERE route_key='investment' FOR UPDATE LOOP
  SELECT * INTO b FROM crm_repair_private.audit32_route_backup WHERE company_id=r.company_id AND route_key=r.route_key;
  IF FOUND THEN
   IF to_jsonb(r) IS DISTINCT FROM b.before_data AND to_jsonb(r) IS DISTINCT FROM b.applied_data THEN
    RAISE EXCEPTION 'SQL32 apply refused: investment route changed since capture';
   END IF;
  ELSE
   IF nullif(btrim(r.meta_phone_number_id),'') IS NOT NULL OR nullif(btrim(r.meta_waba_id),'') IS NOT NULL THEN
    RAISE EXCEPTION 'SQL32 requires explicit review of connected investment line';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.company_lead_routes m WHERE m.company_id=r.company_id AND m.route_key='muscat' AND m.is_active IS TRUE) THEN
    RAISE EXCEPTION 'SQL32 requires an active Muscat route';
   END IF;
   INSERT INTO crm_repair_private.audit32_route_backup(company_id,route_key,before_data)
   VALUES(r.company_id,r.route_key,to_jsonb(r));
  END IF;
 END LOOP;
END $route_guard$;
UPDATE public.company_lead_routes r SET transport_route_key='muscat',whatsapp_number=NULL,
 meta_phone_number_id=NULL,meta_waba_id=NULL,meta_login_configuration_id=NULL,
 label='المستثمرون عبر مسقط',owner_only_inbox=true,
 assigned_to=crm_repair_private.investment_owner(r.company_id),updated_at=clock_timestamp()
WHERE r.route_key='investment' AND (r.transport_route_key IS DISTINCT FROM 'muscat'
 OR r.whatsapp_number IS NOT NULL OR r.meta_phone_number_id IS NOT NULL OR r.meta_waba_id IS NOT NULL
 OR r.meta_login_configuration_id IS NOT NULL OR r.label IS DISTINCT FROM 'المستثمرون عبر مسقط'
 OR r.owner_only_inbox IS DISTINCT FROM true OR r.assigned_to IS DISTINCT FROM crm_repair_private.investment_owner(r.company_id));

CREATE OR REPLACE FUNCTION crm_repair_private.resolve_shared_whatsapp_business_route(
 p_company_id uuid,p_physical_route_key text,p_customer_phone text,p_existing_conversation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
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
 -- Only explicit canonical private context. Legacy investor flags, project
 -- geography, names and model guesses never convert an ordinary contact.
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
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.resolve_shared_whatsapp_business_route(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_repair_private.resolve_shared_whatsapp_business_route(uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_resolve_whatsapp_business_route(
 p_company_id uuid,p_physical_route_key text,p_customer_phone text,p_existing_conversation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT crm_repair_private.resolve_shared_whatsapp_business_route(p_company_id,p_physical_route_key,p_customer_phone,p_existing_conversation_id)
$fn$;
REVOKE ALL ON FUNCTION public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_reception_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_shared_reception_route() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a01_shared_reception_route ON public.company_lead_routes;
CREATE TRIGGER a01_shared_reception_route BEFORE INSERT OR UPDATE ON public.company_lead_routes
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_reception_route();

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_whatsapp_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE physical_ text;resolved_ jsonb;existing_ uuid;phone_ text;private_ boolean;
BEGIN
 phone_:=public.normalize_crm_phone(coalesce(nullif(btrim(new.customer_phone),''),new.customer_wa_id));
 IF TG_OP='INSERT' AND phone_ IS NOT NULL THEN
  -- Same lock as prospective owner classification. Updates already hold the
  -- conversation row, so never take this lock on UPDATE (no lock inversion).
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
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_shared_whatsapp_conversation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a01_shared_whatsapp_conversation ON public.whatsapp_conversations;
CREATE TRIGGER a01_shared_whatsapp_conversation BEFORE INSERT OR UPDATE OF route_key,assigned_to,client_id,meta_phone_number_id,customer_phone,customer_wa_id
ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_whatsapp_conversation();

CREATE OR REPLACE FUNCTION crm_repair_private.validate_shared_whatsapp_request(
 p_company_id uuid,p_conversation_id uuid,p_client_id uuid,p_request_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE conv public.whatsapp_conversations%ROWTYPE;physical_ text;resolved_ jsonb;request_ public.client_requests%ROWTYPE;
BEGIN
 -- Re-evaluate on message persistence as well as webhook resolution. This closes
 -- an owner-classification / inbound-insert race and protects older producers.
 SELECT * INTO conv FROM public.whatsapp_conversations c
 WHERE c.id=p_conversation_id AND c.company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_conversation_context_mismatch' USING ERRCODE='23514';END IF;
 IF conv.route_key IS DISTINCT FROM 'investment' THEN
 SELECT r.route_key INTO physical_ FROM public.company_lead_routes r WHERE r.company_id=conv.company_id
  AND r.meta_phone_number_id=conv.meta_phone_number_id AND r.is_active IS TRUE AND r.route_key IN('muscat','barka','general');
 IF physical_ IS NOT NULL AND public.normalize_crm_phone(coalesce(nullif(btrim(conv.customer_phone),''),conv.customer_wa_id)) IS NOT NULL THEN
  resolved_:=crm_repair_private.resolve_shared_whatsapp_business_route(conv.company_id,physical_,coalesce(nullif(btrim(conv.customer_phone),''),conv.customer_wa_id),conv.id);
  IF resolved_->>'route_key'='investment' THEN
   UPDATE public.whatsapp_conversations SET route_key='investment',assigned_to=(resolved_->>'assigned_to')::uuid
   WHERE id=conv.id AND company_id=conv.company_id;
   conv.route_key:='investment';
  END IF;
 END IF;
 END IF;
 IF p_request_id IS NOT NULL THEN
  SELECT * INTO request_ FROM public.client_requests r WHERE r.id=p_request_id AND r.company_id=p_company_id;
  IF NOT FOUND OR (p_client_id IS NOT NULL AND request_.client_id IS DISTINCT FROM p_client_id) THEN
   RAISE EXCEPTION 'whatsapp_request_context_mismatch' USING ERRCODE='23514';
  END IF;
  IF (coalesce(conv.route_key,'')='investment') IS DISTINCT FROM
    (coalesce(request_.route_key,'')='investment' OR coalesce(request_.branch_key,'')='investment') THEN
   RAISE EXCEPTION 'whatsapp_request_route_compartment_mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.validate_shared_whatsapp_request(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_whatsapp_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 PERFORM crm_repair_private.validate_shared_whatsapp_request(new.company_id,new.conversation_id,new.client_id,new.request_id);
 RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_shared_whatsapp_message() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a01_shared_whatsapp_message ON public.whatsapp_messages;
CREATE TRIGGER a01_shared_whatsapp_message BEFORE INSERT OR UPDATE OF conversation_id,client_id,request_id
ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_whatsapp_message();

CREATE OR REPLACE FUNCTION crm_repair_private.guard_shared_whatsapp_request_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE message_ public.whatsapp_messages%ROWTYPE;
BEGIN
 SELECT * INTO message_ FROM public.whatsapp_messages m WHERE m.id=new.message_id AND m.company_id=new.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'whatsapp_message_context_mismatch' USING ERRCODE='23514';END IF;
 -- The batch RPC writes request changes before this link. Rejecting a stale
 -- compartment here rolls that entire transaction back, including multi-request
 -- batches whose message.request_id is deliberately NULL.
 PERFORM crm_repair_private.validate_shared_whatsapp_request(new.company_id,message_.conversation_id,message_.client_id,new.request_id);
 RETURN new;
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_shared_whatsapp_request_link() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS a01_shared_whatsapp_request_link ON public.whatsapp_message_requests;
CREATE TRIGGER a01_shared_whatsapp_request_link BEFORE INSERT OR UPDATE ON public.whatsapp_message_requests
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_shared_whatsapp_request_link();

CREATE OR REPLACE FUNCTION crm_repair_private.propagate_private_whatsapp_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION crm_repair_private.propagate_private_whatsapp_context() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS z01_private_whatsapp_context ON public.clients;
CREATE TRIGGER z01_private_whatsapp_context AFTER INSERT OR UPDATE OF lead_route,phone,phone_normalized,company_id
ON public.clients FOR EACH ROW EXECUTE FUNCTION crm_repair_private.propagate_private_whatsapp_context();
DROP TRIGGER IF EXISTS z01_private_whatsapp_context ON public.client_requests;
CREATE TRIGGER z01_private_whatsapp_context AFTER INSERT OR UPDATE OF route_key,branch_key,client_id,company_id
ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.propagate_private_whatsapp_context();

UPDATE crm_repair_private.audit32_route_backup b SET applied_data=to_jsonb(r)
FROM public.company_lead_routes r WHERE r.company_id=b.company_id AND r.route_key=b.route_key;
UPDATE crm_repair_private.audit32_catalog_backup b SET applied_definition=pg_get_functiondef(p.oid),applied_acl=p.proacl,applied_owner_id=p.proowner
FROM pg_proc p WHERE b.kind='function' AND p.oid=to_regprocedure(b.identity);
UPDATE crm_repair_private.audit32_catalog_backup b SET applied_definition=pg_get_triggerdef(t.oid)
FROM pg_trigger t WHERE b.kind='trigger' AND t.tgrelid=to_regclass(split_part(b.identity,':',1)) AND t.tgname=split_part(b.identity,':',2);
UPDATE crm_repair_private.audit32_catalog_backup SET applied_definition='text; nullable; no default'
WHERE identity='public.company_lead_routes.transport_route_key';
NOTIFY pgrst,'reload schema';
