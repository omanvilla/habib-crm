-- Guarded schema/configuration rollback. Keep every conversation, message,
-- investor classification and account-revocation audit. This does not re-enable
-- a retired login or resurrect expired sessions. Restore compatible Edge/UI
-- versions together if this rollback is actually needed.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $rollback$
DECLARE catalog_entry record;p record;def text;
BEGIN
 FOR catalog_entry IN SELECT * FROM crm_repair_private.audit32_catalog_backup WHERE kind='function' LOOP
  SELECT pg_get_functiondef(oid) definition,proacl,proowner INTO p FROM pg_proc WHERE oid=to_regprocedure(catalog_entry.identity);
  IF p.definition IS NULL OR p.definition IS DISTINCT FROM catalog_entry.applied_definition
   OR p.proacl IS DISTINCT FROM catalog_entry.applied_acl OR p.proowner IS DISTINCT FROM catalog_entry.applied_owner_id THEN
   RAISE EXCEPTION 'SQL32 rollback refused: function or permissions changed since release';
  END IF;
 END LOOP;
 FOR catalog_entry IN SELECT * FROM crm_repair_private.audit32_catalog_backup WHERE kind='trigger' LOOP
  SELECT pg_get_triggerdef(t.oid) INTO def FROM pg_trigger t
  WHERE t.tgrelid=to_regclass(split_part(catalog_entry.identity,':',1)) AND t.tgname=split_part(catalog_entry.identity,':',2) AND t.tgenabled='O';
  IF def IS NULL OR def IS DISTINCT FROM catalog_entry.applied_definition THEN
   RAISE EXCEPTION 'SQL32 rollback refused: trigger changed since release';
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.company_lead_routes'::regclass
  AND a.attname='transport_route_key' AND a.atttypid='text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef AND NOT a.attisdropped) THEN
  RAISE EXCEPTION 'SQL32 rollback refused: transport column changed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.company_lead_routes r FULL JOIN crm_repair_private.audit32_route_backup b
  ON r.company_id=b.company_id AND r.route_key=b.route_key
  WHERE (r.route_key='investment' OR b.route_key='investment') AND to_jsonb(r) IS DISTINCT FROM b.applied_data) THEN
  RAISE EXCEPTION 'SQL32 rollback refused: investment route changed since capture';
 END IF;
 DROP TRIGGER a01_shared_reception_route ON public.company_lead_routes;
 DROP TRIGGER a01_shared_whatsapp_conversation ON public.whatsapp_conversations;
 DROP TRIGGER a01_shared_whatsapp_message ON public.whatsapp_messages;
 DROP TRIGGER a01_shared_whatsapp_request_link ON public.whatsapp_message_requests;
 DROP TRIGGER z01_private_whatsapp_context ON public.clients;
 DROP TRIGGER z01_private_whatsapp_context ON public.client_requests;
 DROP FUNCTION public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid);
 DROP FUNCTION crm_repair_private.guard_shared_reception_route();
 DROP FUNCTION crm_repair_private.guard_shared_whatsapp_conversation();
 DROP FUNCTION crm_repair_private.guard_shared_whatsapp_message();
 DROP FUNCTION crm_repair_private.guard_shared_whatsapp_request_link();
 DROP FUNCTION crm_repair_private.validate_shared_whatsapp_request(uuid,uuid,uuid,uuid);
 DROP FUNCTION crm_repair_private.propagate_private_whatsapp_context();
 DROP FUNCTION crm_repair_private.resolve_shared_whatsapp_business_route(uuid,text,text,uuid);
 UPDATE public.company_lead_routes r SET label=b.before_data->>'label',
  whatsapp_number=b.before_data->>'whatsapp_number',meta_phone_number_id=b.before_data->>'meta_phone_number_id',
  meta_waba_id=b.before_data->>'meta_waba_id',meta_login_configuration_id=b.before_data->>'meta_login_configuration_id',
  assigned_to=(b.before_data->>'assigned_to')::uuid,owner_only_inbox=(b.before_data->>'owner_only_inbox')::boolean,
  transport_route_key=NULL,updated_at=(b.before_data->>'updated_at')::timestamptz
 FROM crm_repair_private.audit32_route_backup b WHERE r.company_id=b.company_id AND r.route_key=b.route_key;
 ALTER TABLE public.company_lead_routes DROP COLUMN transport_route_key;
END $rollback$;
NOTIFY pgrst,'reload schema';
