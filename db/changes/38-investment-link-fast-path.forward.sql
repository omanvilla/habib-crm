-- SQL38: exact fast path for crm_repair_private.investment_link_is_private.
--
-- investment_row_allowed() runs this recursive walk for every non-owner row;
-- profiled as the active agent it cost ≈8.9 s over 10,473 WhatsApp messages
-- and found nothing private. The walk returns true only on reaching a row whose
-- own lead_route/route_key/branch_key is 'investment' (or nested before_data/
-- after_data of the starting row). Among the 15 tables it can follow, exactly
-- six columns can hold that marker:
--   clients.lead_route, client_requests.route_key, client_requests.branch_key,
--   whatsapp_conversations.route_key, properties.branch_key, appointments.branch_key
-- and none has before_data/after_data/entity_type. So when none of those six
-- columns holds 'investment' anywhere, no linked lookup can return true and the
-- walk may stop right after the row's own checks.
--
-- 1. Five partial indexes make that "any marker?" test five empty-index probes.
-- 2. The test is inlined in the walk (static SQL keeps cached plans; a nested
--    SECURITY DEFINER call cost ~0.18 ms per row). Own-row markers and nested
--    before_data/after_data are still checked first. When any marker exists the
--    original full walk runs unchanged.
-- 3. An event trigger rejects DDL that gives the 15 tables any other
--    marker-capable column, so the six-column premise cannot silently drift.

CREATE INDEX IF NOT EXISTS clients_investment_marker_idx
  ON public.clients (id) WHERE lead_route = 'investment';
CREATE INDEX IF NOT EXISTS client_requests_investment_marker_idx
  ON public.client_requests (id) WHERE route_key = 'investment' OR branch_key = 'investment';
CREATE INDEX IF NOT EXISTS whatsapp_conversations_investment_marker_idx
  ON public.whatsapp_conversations (id) WHERE route_key = 'investment';
CREATE INDEX IF NOT EXISTS properties_investment_marker_idx
  ON public.properties (id) WHERE branch_key = 'investment';
CREATE INDEX IF NOT EXISTS appointments_investment_marker_idx
  ON public.appointments (id) WHERE branch_key = 'investment';

-- Marker-capable columns on the walk's tables beyond the six above (empty = premise holds).
CREATE OR REPLACE FUNCTION crm_repair_private.investment_marker_columns_unexpected()
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(array_agg(c.relname || '.' || a.attname ORDER BY c.relname, a.attname), '{}')
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('clients','client_requests','deals','deposits','viewings','appointments',
                      'property_inquiries','tasks','events','whatsapp_conversations','instagram_conversations',
                      'whatsapp_messages','instagram_messages','properties','property_marketing_events')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname IN ('lead_route','route_key','branch_key','before_data','after_data','entity_type')
    AND (c.relname || '.' || a.attname) NOT IN (
      'clients.lead_route','client_requests.route_key','client_requests.branch_key',
      'whatsapp_conversations.route_key','properties.branch_key','appointments.branch_key');
$function$;

REVOKE ALL ON FUNCTION crm_repair_private.investment_marker_columns_unexpected() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_marker_columns()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE extra text[];
BEGIN
  extra := crm_repair_private.investment_marker_columns_unexpected();
  IF cardinality(extra) > 0 THEN
    RAISE EXCEPTION 'investment fast path (SQL38) assumes only six marker columns; found also: %. Update crm_repair_private.investment_link_is_private and its marker indexes first.', extra;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION crm_repair_private.guard_investment_marker_columns() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS crm_guard_investment_marker_columns;
CREATE EVENT TRIGGER crm_guard_investment_marker_columns ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE', 'CREATE TABLE')
  EXECUTE FUNCTION crm_repair_private.guard_investment_marker_columns();

-- Only change below: the inline fast-path block after the row's own marker check.
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

REVOKE ALL ON FUNCTION crm_repair_private.investment_link_is_private(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF cardinality(crm_repair_private.investment_marker_columns_unexpected()) > 0 THEN
    RAISE EXCEPTION 'SQL38: unexpected investment marker columns: %', crm_repair_private.investment_marker_columns_unexpected();
  END IF;
END $$;
