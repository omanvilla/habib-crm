-- SQL38 rollback: restore the original full-walk investment_link_is_private,
-- then drop the event trigger, helpers and marker indexes.
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

REVOKE ALL ON FUNCTION crm_repair_private.investment_link_is_private(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS crm_guard_investment_marker_columns;
DROP FUNCTION IF EXISTS crm_repair_private.guard_investment_marker_columns();
DROP FUNCTION IF EXISTS crm_repair_private.investment_marker_columns_unexpected();
DROP INDEX IF EXISTS public.clients_investment_marker_idx;
DROP INDEX IF EXISTS public.client_requests_investment_marker_idx;
DROP INDEX IF EXISTS public.whatsapp_conversations_investment_marker_idx;
DROP INDEX IF EXISTS public.properties_investment_marker_idx;
DROP INDEX IF EXISTS public.appointments_investment_marker_idx;
