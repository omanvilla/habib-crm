-- Rollback for SQL68. First publish the front end and deploy the previous
-- whatsapp-webhook / whatsapp-embedded-signup / whatsapp-direct-bind /
-- whatsapp-inbox / whatsapp-reply-agent, then run this file.
-- It refuses while owner-line data exists: those rows would lose their owner-only
-- protection. Unlink the number in Meta and decide what to keep before rolling back.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE route_key = 'owner') THEN
    RAISE EXCEPTION 'SQL68 rollback refused: owner-line conversations exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_onboarding_events WHERE route_key = 'owner') THEN
    RAISE EXCEPTION 'SQL68 rollback refused: owner-line onboarding events exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_route_credentials WHERE route_key = 'owner') THEN
    RAISE EXCEPTION 'SQL68 rollback refused: owner-line credentials exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_lead_routes WHERE route_key = 'owner'
               AND (is_active OR nullif(btrim(coalesce(meta_phone_number_id, '')), '') IS NOT NULL
                    OR nullif(btrim(coalesce(meta_waba_id, '')), '') IS NOT NULL)) THEN
    RAISE EXCEPTION 'SQL68 rollback refused: the owner line is still linked';
  END IF;
END $guard$;

DROP TRIGGER IF EXISTS a02_owner_private_route ON public.company_lead_routes;
DELETE FROM public.company_lead_routes WHERE route_key = 'owner';
DROP TRIGGER IF EXISTS a02_owner_private_conversation ON public.whatsapp_conversations;
DROP TRIGGER IF EXISTS a00_owner_private_message ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.guard_owner_private_route();
DROP FUNCTION IF EXISTS crm_repair_private.guard_owner_private_conversation();
DROP FUNCTION IF EXISTS crm_repair_private.guard_owner_private_message();
DROP INDEX IF EXISTS public.whatsapp_conversations_owner_route_idx;

ALTER TABLE public.company_lead_routes DROP CONSTRAINT IF EXISTS company_lead_routes_key_check;
ALTER TABLE public.company_lead_routes ADD CONSTRAINT company_lead_routes_key_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general']));
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_route_check;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_route_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general']));
ALTER TABLE public.whatsapp_onboarding_events DROP CONSTRAINT IF EXISTS whatsapp_onboarding_events_route_check;
ALTER TABLE public.whatsapp_onboarding_events ADD CONSTRAINT whatsapp_onboarding_events_route_check
  CHECK (route_key = ANY (ARRAY['muscat','barka','investment','general']));

-- Definitions as they were live on 5 Nov 2026 before SQL68.
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
  AND (coalesce(all_lines_,false) OR c.route_key='investment' OR EXISTS(
   SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=c.company_id
    AND r.route_key='muscat' AND r.is_active IS TRUE AND r.meta_phone_number_id=c.meta_phone_number_id))
  AND (c.route_key IS DISTINCT FROM 'investment' OR c.assigned_to IS DISTINCT FROM owner_);
 RETURN new;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.investment_link_is_private(uuid,jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.propagate_private_whatsapp_context() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_touch_whatsapp_conversation(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.whatsapp_conversations%rowtype; m public.whatsapp_messages%rowtype; v_unread boolean;
BEGIN
 SELECT * INTO c FROM public.whatsapp_conversations WHERE id=p_conversation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=c.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 IF m.conversation_touched_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'unread_count',c.unread_count); END IF;
 v_unread:=m.direction='inbound';
 UPDATE public.whatsapp_conversations SET
  last_message_at=greatest(last_message_at,coalesce(m.message_timestamp,m.created_at)),
  last_inbound_at=CASE WHEN m.direction='inbound' THEN greatest(last_inbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_inbound_at END,
  last_outbound_at=CASE WHEN m.direction='outbound' THEN greatest(last_outbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_outbound_at END,
  last_message_seq=last_message_seq+1,unread_count=coalesce(unread_count,0)+CASE WHEN v_unread THEN 1 ELSE 0 END,updated_at=now()
 WHERE id=c.id RETURNING * INTO c;
 UPDATE public.whatsapp_messages SET conversation_touched_at=now(),ingestion_seq=c.last_message_seq WHERE id=m.id;
 RETURN jsonb_build_object('ok',true,'unread_count',c.unread_count);
END $function$;
REVOKE ALL ON FUNCTION public.crm_touch_whatsapp_conversation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_touch_whatsapp_conversation(uuid,uuid) TO service_role;
