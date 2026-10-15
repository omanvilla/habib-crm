-- Canonical investment is owner-only. Existing clients/routes/deals are not rewritten.
-- All ordinary branch rules remain in place; new restrictive policies are an additional gate.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.investment_catalog_backup(
 object_identity text PRIMARY KEY,object_kind text NOT NULL,definition text NOT NULL,acl jsonb,owner_name text,captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.investment_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.investment_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.investment_catalog_backup(object_identity,object_kind,definition,acl,owner_name)
SELECT p.oid::regprocedure::text,'function',pg_get_functiondef(p.oid),to_jsonb(p.proacl),pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','crm_repair_private') AND p.proname IN('staff_can_access_branch','can_access_client','can_access_request','can_access_whatsapp_conversation','can_access_deal_workflow','crm_set_request_geography','crm_sync_request_assignees','crm_refresh_client_primary_assignment','refresh_client_request_summary','sync_client_summary_after_request_change','touch_client_contact_from_whatsapp','sync_client_pipeline_from_property_inquiry','upsert_whatsapp_client_identity','capture_request_response_milestones','reset_stale_requirement_prompt_on_new_inbound','process_followup_reply_from_whatsapp','apply_whatsapp_client_request','sync_viewing_to_crm','crm_employee_performance','crm_mark_instagram_read','crm_public_business_routes','record_property_link_inquiry_internal','crm_finalize_property_message') ON CONFLICT(object_identity) DO NOTHING;
INSERT INTO crm_repair_private.investment_catalog_backup(object_identity,object_kind,definition,acl,owner_name) SELECT c.oid::regclass::text,'view','CREATE OR REPLACE VIEW '||c.oid::regclass::text||' WITH (security_barrier=true) AS '||pg_get_viewdef(c.oid,true),to_jsonb(c.relacl),pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('crm_properties_access','crm_deals_access') ON CONFLICT(object_identity) DO NOTHING;

-- Notification context is nullable, preserving every existing notification and recipient.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.client_requests(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_owner(p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id FROM public.profiles p WHERE p.company_id=p_company AND p.role='owner' AND p.is_active IS TRUE
 ORDER BY (p.id=(SELECT auth.uid())) DESC,
 EXISTS(SELECT 1 FROM public.company_lead_routes r WHERE r.company_id=p_company AND r.route_key='investment' AND r.assigned_to=p.id) DESC,p.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION crm_repair_private.investment_owner(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_repair_private.investment_owner(uuid) TO service_role;

-- Traverse only explicit, same-company references. No reverse contact history inference,
-- legacy investor flags, arbitrary identifiers, or cross-company lookups are used.
CREATE OR REPLACE FUNCTION crm_repair_private.investment_link_is_private(p_company uuid,p_row jsonb,p_seen text[] DEFAULT '{}'::text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.investment_link_is_private(uuid,jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.investment_row_allowed(p_company uuid,p_row jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_role text;
BEGIN
 SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.company_id=p_company AND p.is_active IS TRUE;
 IF actor_role IS NULL THEN RETURN false;END IF;
 IF actor_role='owner' THEN RETURN true;END IF;
 RETURN NOT crm_repair_private.investment_link_is_private(p_company,p_row);
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.investment_row_allowed(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.investment_row_allowed(uuid,jsonb) TO authenticated,service_role;

-- Shared AI caches must not persist investor evidence into public client/property summaries.
-- Only the current owner can classify actual same-company rows; no data or identifiers are returned.
CREATE OR REPLACE FUNCTION public.crm_shared_ai_evidence_mask(p_rows jsonb)
RETURNS boolean[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid:=public.my_company();item jsonb;table_name text;row_id uuid;row_data jsonb;result boolean[]:='{}'::boolean[];
BEGIN
 IF auth.uid() IS NULL OR company IS NULL OR public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR octet_length(p_rows::text)>262144 THEN RAISE EXCEPTION 'invalid_evidence_rows' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'too_many_evidence_rows' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item-'table'-'id')<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid_evidence_row' USING ERRCODE='22023';END IF;
  table_name:=item->>'table';
  IF table_name IS NULL OR table_name NOT IN('clients','client_requests','property_inquiries','viewings','property_rejection_reasons','deals','whatsapp_messages','properties','property_marketing_events') THEN RAISE EXCEPTION 'invalid_evidence_table' USING ERRCODE='22023';END IF;
  BEGIN row_id:=nullif(item->>'id','')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_evidence_id' USING ERRCODE='22023';END;
  IF row_id IS NULL THEN RAISE EXCEPTION 'invalid_evidence_id' USING ERRCODE='22023';END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id=$1 AND t.company_id=$2',table_name) INTO row_data USING row_id,company;
  result:=array_append(result,row_data IS NOT NULL AND NOT crm_repair_private.investment_link_is_private(company,row_data));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_shared_ai_evidence_mask(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_shared_ai_evidence_mask(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid;norm_phone text;
BEGIN
 IF TG_OP='INSERT' AND nullif(btrim(new.lead_route),'') IS NULL AND (new.client_type='investor' OR new.is_investor IS TRUE)
   AND public.my_company()=new.company_id AND public.my_role()='owner' THEN new.lead_route:='investment';END IF;
 IF TG_OP='UPDATE' AND old.lead_route='investment' AND new.lead_route IS DISTINCT FROM 'investment'
   AND (public.my_company() IS DISTINCT FROM new.company_id OR public.my_role() IS DISTINCT FROM 'owner') THEN
   RAISE EXCEPTION 'investment_route_change_requires_owner' USING ERRCODE='42501';
 END IF;
 IF new.lead_route='investment' THEN
  IF auth.uid() IS NOT NULL AND (public.my_company() IS DISTINCT FROM new.company_id OR public.my_role() IS DISTINCT FROM 'owner') THEN RAISE EXCEPTION 'investment_owner_only' USING ERRCODE='42501';END IF;
  owner_id:=crm_repair_private.investment_owner(new.company_id);
  IF owner_id IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
  new.assigned_to:=owner_id;new.client_type:='investor';new.is_investor:=true;
 END IF;
 IF TG_OP='INSERT' OR new.phone IS DISTINCT FROM old.phone THEN
  norm_phone:=public.normalize_crm_phone(new.phone);
  IF norm_phone IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(new.company_id::text||':client-normalized-phone:'||norm_phone,0));
   IF EXISTS(SELECT 1 FROM public.clients c WHERE c.company_id=new.company_id AND c.id IS DISTINCT FROM new.id
     AND c.phone_normalized=norm_phone AND (new.lead_route='investment' OR c.lead_route='investment')) THEN
    RAISE EXCEPTION 'client_phone_already_exists' USING ERRCODE='23505';
   END IF;
  END IF;
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_investment_client() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a00_guard_investment_client BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_client();

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE private_client boolean; owner_id uuid;
BEGIN
 SELECT c.lead_route='investment' INTO private_client FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id;
 IF private_client OR new.route_key='investment' OR new.branch_key='investment' THEN
  IF auth.uid() IS NOT NULL AND (public.my_company() IS DISTINCT FROM new.company_id OR public.my_role() IS DISTINCT FROM 'owner') THEN RAISE EXCEPTION 'investment_owner_only' USING ERRCODE='42501';END IF;
  owner_id:=crm_repair_private.investment_owner(new.company_id);
  IF owner_id IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
  new.route_key:='investment';new.branch_key:='investment';new.request_type:='investor';new.assigned_to:=owner_id;new.manual_assigned_to:=NULL;
 END IF;
 IF TG_OP='UPDATE' AND (old.route_key='investment' OR old.branch_key='investment') AND new.route_key IS DISTINCT FROM 'investment'
   AND (public.my_company() IS DISTINCT FROM new.company_id OR public.my_role() IS DISTINCT FROM 'owner') THEN RAISE EXCEPTION 'investment_route_change_requires_owner' USING ERRCODE='42501';END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_investment_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a00_guard_investment_request BEFORE INSERT OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_request();
CREATE TRIGGER zzz_guard_investment_request BEFORE INSERT OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_request();

CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.route_key='investment' THEN
  new.owner_only_inbox:=true;new.assigned_to:=crm_repair_private.investment_owner(new.company_id);
  IF new.assigned_to IS NULL THEN RAISE EXCEPTION 'investment_owner_not_configured' USING ERRCODE='23514';END IF;
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_investment_route() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a00_guard_investment_route BEFORE INSERT OR UPDATE ON public.company_lead_routes FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_route();

-- Definer write paths also obey this boundary when invoked by a browser user.
-- Backend service ingestion has no user JWT and is separately authenticated by Edge.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_investment_linked_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_investment_linked_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY investment_owner_only ON public.events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.deals AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deals))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deals)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(public.my_company(),to_jsonb(notifications))) WITH CHECK (crm_repair_private.investment_row_allowed(public.my_company(),to_jsonb(notifications)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.notifications FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.company_lead_routes AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(company_lead_routes))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(company_lead_routes)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.company_lead_routes FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.deposits AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deposits))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deposits)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.deposits FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.viewings AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(viewings))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(viewings)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.viewings FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.tasks AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(tasks))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(tasks)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.clients AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(clients))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(clients)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.property_marketing_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_marketing_events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_marketing_events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.property_marketing_events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_conversations))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_conversations)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_messages))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_messages)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_message_requests AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_message_requests))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_message_requests)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_message_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.client_request_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_request_events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_request_events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.client_request_events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.client_requests AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_requests))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_requests)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.property_inquiries AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_inquiries))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_inquiries)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.property_inquiries FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.appointments AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(appointments))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(appointments)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.appointment_properties AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(appointment_properties))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(appointment_properties)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.activities AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(activities))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(activities)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.activities FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.property_rejection_reasons AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_rejection_reasons))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_rejection_reasons)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.property_rejection_reasons FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.property_action_reviews AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_action_reviews))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_action_reviews)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.property_action_reviews FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.measurement_targets AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(measurement_targets))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(measurement_targets)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.measurement_targets FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_onboarding_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_onboarding_events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_onboarding_events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_onboarding_events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.deal_stage_history AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deal_stage_history))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(deal_stage_history)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.deal_stage_history FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.properties AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(properties))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(properties)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_automation_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_automation_events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_automation_events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_automation_events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.unmatched_property_links AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(unmatched_property_links))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(unmatched_property_links)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.unmatched_property_links FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_route_credentials AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_route_credentials))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_route_credentials)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_route_credentials FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.client_request_assignees AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_request_assignees))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(client_request_assignees)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.client_request_assignees FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.instagram_outbound_operations AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_outbound_operations))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_outbound_operations)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.instagram_outbound_operations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_followup_optouts AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_optouts))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_optouts)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_followup_optouts FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_template_registry AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_template_registry))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_template_registry)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_template_registry FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_followup_events AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_events))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_events)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_followup_events FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_followup_optins AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_optins))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_followup_optins)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_followup_optins FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.instagram_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_conversations))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_conversations)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.instagram_conversations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.instagram_messages AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_messages))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(instagram_messages)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.instagram_messages FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.whatsapp_send_operations AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_send_operations))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(whatsapp_send_operations)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.whatsapp_send_operations FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();
CREATE POLICY investment_owner_only ON public.property_message_attributions AS RESTRICTIVE FOR ALL TO authenticated USING (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_message_attributions))) WITH CHECK (crm_repair_private.investment_row_allowed(company_id,to_jsonb(property_message_attributions)));
CREATE TRIGGER zzz_investment_linked_write BEFORE INSERT OR UPDATE OR DELETE ON public.property_message_attributions FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_investment_linked_write();

CREATE OR REPLACE FUNCTION crm_repair_private.staff_can_access_branch(p_company uuid, p_branch text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and (p_branch IS DISTINCT FROM 'investment' OR p.role='owner')
     and (p.role in ('owner','manager','viewer')
       or (p.role='agent' and exists(
         select 1 from public.company_lead_routes r
         where r.company_id=p_company and r.assigned_to=p.id
           and r.route_key=p_branch and r.owner_only_inbox is false)))
 );
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(c))
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(c.lead_route,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,c.lead_route)) AND (c.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_requests r
          WHERE r.company_id=p.company_id AND r.client_id=c.id AND r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment' AND
            ((r.assigned_to=p.id AND r.status<>'archived') OR
              (r.status IN ('active','paused') AND EXISTS(
                SELECT 1 FROM public.client_request_assignees a
                WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id))))))))
  )
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(r))
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(r.branch_key,r.route_key,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,coalesce(r.branch_key,r.route_key))) AND (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))
  )
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_whatsapp_conversation(p_company_id uuid, p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
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
 ) $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_deal_workflow(p_deal_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.deals d JOIN public.profiles u ON u.company_id=d.company_id
 WHERE d.id=p_deal_id AND u.id=auth.uid() AND u.is_active IS TRUE AND crm_repair_private.investment_row_allowed(d.company_id,to_jsonb(d)) AND
 (u.role IN('owner','manager') OR (u.role='agent' AND d.agent_id=u.id
 AND (d.client_id IS NULL OR crm_repair_private.can_access_client(d.company_id,d.client_id))
 AND (d.request_id IS NULL OR crm_repair_private.can_access_request(d.company_id,d.request_id))
 AND (d.property_id IS NULL OR EXISTS(SELECT 1 FROM public.properties p WHERE p.id=d.property_id AND p.company_id=d.company_id
 AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))))))
$function$;

CREATE OR REPLACE FUNCTION public.crm_set_request_geography()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  logical_route text;
  primary_route text;
  primary_user uuid;
  physical_route text;
begin
  IF new.route_key='investment' OR new.branch_key='investment' THEN
    new.route_key:='investment';new.branch_key:='investment';new.request_type:='investor';
    new.assigned_to:=crm_repair_private.investment_owner(new.company_id);new.manual_assigned_to:=NULL;
    RETURN new;
  END IF;
  branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);

  if array_length(branches,1) is null then
    -- A manual assignee/property-specific request remains independent of inbox routing.
    if new.manual_assigned_to is null and new.subject_property_id is null then
      physical_route:=crm_repair_private.whatsapp_request_physical_branch(
        new.company_id,new.client_id,new.origin_whatsapp_message_id,new.inbound_number);
    end if;
    logical_route := coalesce(physical_route,'general');
    primary_route := coalesce(physical_route,'muscat');
  elsif array_length(branches,1)=1 then
    logical_route := branches[1];
    primary_route := branches[1];
  else
    logical_route := 'general';
    primary_route := 'muscat';
  end if;

  select r.assigned_to into primary_user
  from public.company_lead_routes r
  where r.company_id=new.company_id and r.route_key=primary_route and r.is_active=true
  limit 1;

  new.branch_key := logical_route;
  new.route_key := logical_route;
  IF new.manual_assigned_to IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=new.manual_assigned_to
      AND p.company_id=new.company_id AND p.is_active IS TRUE AND p.role IN('owner','manager','agent')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual_assignee_not_active_in_company';
    END IF;
    new.assigned_to:=new.manual_assigned_to;
  ELSIF primary_user IS NOT NULL THEN new.assigned_to:=primary_user;
  END IF;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_sync_request_assignees()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  b text;
  uid uuid;
  physical_route text;
begin
  delete from public.client_request_assignees where request_id=new.id;

  if new.status in ('active','paused') then
    IF new.route_key='investment' OR new.branch_key='investment' THEN
      uid:=crm_repair_private.investment_owner(new.company_id);
      insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
      values(new.id,new.company_id,uid,'investment') on conflict do nothing;
      IF EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id AND c.lead_route='investment') THEN perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);END IF;
      return new;
    END IF;
    IF new.manual_assigned_to IS NOT NULL THEN
      insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
      values(new.id,new.company_id,new.manual_assigned_to,coalesce(new.branch_key,'general'))
      on conflict do nothing;
      perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
      return new;
    END IF;
    branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);
    if array_length(branches,1) is null then
      if new.subject_property_id is null then
        physical_route:=crm_repair_private.whatsapp_request_physical_branch(
          new.company_id,new.client_id,new.origin_whatsapp_message_id,new.inbound_number);
      end if;
      branches:=array[coalesce(physical_route,'muscat')]::text[];
    end if;

    foreach b in array branches loop
      select r.assigned_to into uid
      from public.company_lead_routes r
      where r.company_id=new.company_id and r.route_key=b and r.is_active=true
      limit 1;
      if uid is not null then
        insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
        values(new.id,new.company_id,uid,b)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  IF (new.route_key IS DISTINCT FROM 'investment' AND new.branch_key IS DISTINCT FROM 'investment') OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id AND c.lead_route='investment') THEN perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);END IF;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_refresh_client_primary_assignment(p_company_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  users uuid[];
  branches text[];
  primary_user uuid;
  primary_route text;
begin
  IF EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.company_id=p_company_id AND c.lead_route='investment') THEN
    UPDATE public.clients SET assigned_to=crm_repair_private.investment_owner(p_company_id)
    WHERE id=p_client_id AND company_id=p_company_id AND assigned_to IS DISTINCT FROM crm_repair_private.investment_owner(p_company_id);
    RETURN;
  END IF;
  select array_agg(distinct a.user_id), array_agg(distinct a.branch_key)
    into users,branches
  from public.client_request_assignees a
  join public.client_requests r on r.id=a.request_id
  where a.company_id=p_company_id and r.client_id=p_client_id and r.status in ('active','paused') AND r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment';

  if coalesce(array_length(users,1),0)=0 then return; end if;

  if array_length(users,1)=1 then
    primary_user:=users[1];
    if 'investment'=any(branches) and coalesce(array_length(branches,1),0)=1 then primary_route:='investment';
    elsif 'barka'=any(branches) and not ('muscat'=any(branches)) then primary_route:='barka';
    elsif 'muscat'=any(branches) and not ('barka'=any(branches)) then primary_route:='muscat';
    else primary_route:='general'; end if;
  else
    select c.assigned_to into primary_user from public.clients c where c.id=p_client_id and c.company_id=p_company_id;
    if primary_user is null or not (primary_user=any(users)) then
      select r.assigned_to into primary_user from public.company_lead_routes r where r.company_id=p_company_id and r.route_key='muscat' and r.is_active=true limit 1;
      if primary_user is null or not (primary_user=any(users)) then primary_user:=users[1]; end if;
    end if;
    primary_route:='general';
  end if;

  update public.clients
     set assigned_to=primary_user,
         lead_route=primary_route
   where id=p_client_id and company_id=p_company_id
     and (assigned_to is distinct from primary_user or lead_route is distinct from primary_route);

  -- Physical WhatsApp inbox assignment belongs to its configured line, not request geography.

end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_client_request_summary(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_current public.client_requests%rowtype;
  v_max_score integer;
  v_temp text;
  v_is_buyer boolean;
  v_is_seller boolean;
  v_is_investor boolean;
begin
  select r.* into v_current
  from public.client_requests r
  where r.client_id = p_client_id
    AND (EXISTS(SELECT 1 FROM public.clients c0 WHERE c0.id=p_client_id AND c0.lead_route='investment') OR (r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment'))
    and r.status not in ('cancelled','archived')
  order by
    case when r.status = 'active' then 0 when r.status = 'paused' then 1 else 2 end,
    r.priority desc,
    r.updated_at desc
  limit 1;

  if v_current.id is null then
    update public.clients c
    set preferred_area=null,
        wilayat=null,
        property_type=null,
        budget_min=null,
        budget_max=null,
        payment_method=null,
        purchase_timing=null,
        purpose=null
    where c.id=p_client_id;
    return;
  end if;

  -- Roles are historical; lead temperature/score should reflect active work first.
  select
    bool_or(r.request_type in ('buyer','investor')),
    bool_or(r.request_type = 'seller'),
    bool_or(r.request_type = 'investor' or r.purpose in ('investment','resale'))
  into v_is_buyer, v_is_seller, v_is_investor
  from public.client_requests r
  where r.client_id = p_client_id
    AND (EXISTS(SELECT 1 FROM public.clients c0 WHERE c0.id=p_client_id AND c0.lead_route='investment') OR (r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment'))
    and r.status <> 'archived';

  select max(r.lead_score) into v_max_score
  from public.client_requests r
  where r.client_id = p_client_id
    AND (EXISTS(SELECT 1 FROM public.clients c0 WHERE c0.id=p_client_id AND c0.lead_route='investment') OR (r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment'))
    and r.status in ('active','paused');

  if v_max_score is null then v_max_score := coalesce(v_current.lead_score,20); end if;
  v_temp := case when v_max_score >= 65 then 'hot' when v_max_score >= 35 then 'warm' else 'cold' end;

  update public.clients c
  set
    client_type = v_current.request_type,
    is_buyer = coalesce(c.is_buyer,false) or coalesce(v_is_buyer,false),
    is_seller = coalesce(c.is_seller,false) or coalesce(v_is_seller,false),
    is_investor = coalesce(c.is_investor,false) or coalesce(v_is_investor,false),
    preferred_area = v_current.preferred_area,
    wilayat = v_current.wilayat,
    property_type = v_current.property_type,
    budget_min = v_current.budget_min,
    budget_max = v_current.budget_max,
    payment_method = v_current.payment_method,
    purchase_timing = v_current.purchase_timing,
    purpose = v_current.purpose,
    -- Client-level heat is only a summary of the strongest active request.
    lead_score = coalesce(v_max_score,20),
    lead_temperature = v_temp,
    status = v_temp,
    last_contact_at = greatest(
      c.last_contact_at,
      (select max(r.last_contact_at) from public.client_requests r where r.client_id=p_client_id AND (EXISTS(SELECT 1 FROM public.clients c0 WHERE c0.id=p_client_id AND c0.lead_route='investment') OR (r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment')))
    )
  where c.id = p_client_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_client_summary_after_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  IF TG_OP='DELETE' THEN
    IF (old.route_key='investment' OR old.branch_key='investment') AND EXISTS(SELECT 1 FROM public.clients c WHERE c.id=old.client_id AND c.lead_route IS DISTINCT FROM 'investment') THEN RETURN old;END IF;
  ELSE
    IF (new.route_key='investment' OR new.branch_key='investment') AND EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.lead_route IS DISTINCT FROM 'investment') THEN RETURN new;END IF;
  END IF;
  if tg_op = 'DELETE' then
    perform public.refresh_client_request_summary(old.client_id);
    return old;
  end if;

  perform public.refresh_client_request_summary(new.client_id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_client_contact_from_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF EXISTS(SELECT 1 FROM public.whatsapp_conversations w JOIN public.clients c ON c.id=new.client_id AND c.company_id=new.company_id
    WHERE w.id=new.conversation_id AND w.company_id=new.company_id AND w.route_key='investment' AND c.lead_route IS DISTINCT FROM 'investment') THEN RETURN new;END IF;
  if new.client_id is null then return new; end if;
  if new.direction='outbound' and coalesce(new.actor_type,'')='human' then
    update public.clients
      set human_contact_at=greatest(coalesce(human_contact_at,'epoch'::timestamptz),coalesce(new.message_timestamp,new.created_at,now())),
          last_contact_at=greatest(coalesce(last_contact_at,'epoch'::timestamptz),coalesce(new.message_timestamp,new.created_at,now())),
          followup_suppressed=false,
          followup_suppressed_reason=null,
          followup_suppressed_at=null,
          followup_suppressed_by=null,
          updated_at=now()
    where id=new.client_id and company_id=new.company_id;
  elsif new.direction='inbound' then
    update public.clients
      set followup_suppressed=false,
          followup_suppressed_reason=null,
          followup_suppressed_at=null,
          followup_suppressed_by=null,
          updated_at=now()
    where id=new.client_id and company_id=new.company_id and followup_suppressed=true;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_property_inquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_stage text;
  target_rank int;
  current_stage text;
  current_rank int;
begin
  IF EXISTS(SELECT 1 FROM public.client_requests r JOIN public.clients c ON c.id=new.client_id AND c.company_id=new.company_id
    WHERE r.id=new.request_id AND r.company_id=new.company_id AND (r.route_key='investment' OR r.branch_key='investment') AND c.lead_route IS DISTINCT FROM 'investment') THEN RETURN new;END IF;
  target_stage := case new.status
    when 'inquiry' then 'contacted'
    when 'followup' then 'contacted'
    when 'viewing_scheduled' then 'viewing_scheduled'
    when 'viewed' then 'viewed'
    when 'negotiation' then 'negotiating'
    when 'reserved' then 'deposit'
    when 'deal' then 'negotiating'
    else null
  end;

  if target_stage is null then
    return new;
  end if;

  select c.pipeline_stage into current_stage
  from public.clients c
  where c.id = new.client_id and c.company_id = new.company_id;

  current_rank := case current_stage
    when 'new' then 0
    when 'contacted' then 1
    when 'qualified' then 2
    when 'options_sent' then 3
    when 'viewing_scheduled' then 4
    when 'viewed' then 5
    when 'negotiating' then 6
    when 'awaiting_finance' then 7
    when 'deposit' then 8
    when 'sold' then 9
    else 0
  end;

  target_rank := case target_stage
    when 'contacted' then 1
    when 'viewing_scheduled' then 4
    when 'viewed' then 5
    when 'negotiating' then 6
    when 'deposit' then 8
    else 0
  end;

  if target_rank > current_rank then
    update public.clients
    set pipeline_stage = target_stage
    where id = new.client_id and company_id = new.company_id;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_whatsapp_client_identity(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client public.clients%rowtype;
  v_client_id uuid;
  v_created boolean := false;
  v_phone text := btrim(coalesce(p_phone,''));
  v_name text := nullif(left(btrim(coalesce(p_customer_name,'')),120),'');
  v_route text := lower(btrim(coalesce(p_route_key,'general')));
  v_effective_assigned uuid;
begin
  if p_company_id is null or not exists (select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'Invalid company';
  end if;
  if v_phone !~ '^\+[0-9]{7,15}$' then
    raise exception 'Invalid WhatsApp phone';
  end if;
  if v_route not in ('muscat','barka','investment','general') then v_route := 'general'; end if;

  select c.* into v_client
  from public.clients c
  where c.company_id=p_company_id
    and (CASE WHEN v_route='investment' THEN public.normalize_crm_phone(c.phone)=public.normalize_crm_phone(v_phone) ELSE regexp_replace(coalesce(c.phone,''), '[^0-9+]', '', 'g')=v_phone END)
  order by c.created_at asc
  limit 1;

  IF v_route='investment' THEN
    p_assigned_to:=crm_repair_private.investment_owner(p_company_id);
    IF v_client.id IS NOT NULL AND v_client.lead_route IS DISTINCT FROM 'investment' THEN
      RETURN jsonb_build_object('ok',true,'client_id',v_client.id,'created',false,'assigned_to',p_assigned_to,'route_key','investment');
    END IF;
  END IF;

  if v_client.id is null then
    insert into public.clients(
      company_id,name,phone,client_type,is_buyer,is_seller,is_investor,
      notes,status,lead_temperature,lead_score,source,pipeline_stage,
      assigned_to,lead_route,inbound_number,last_contact_at
    ) values (
      p_company_id,
      coalesce(v_name,'عميل واتساب '||right(v_phone,4)),
      v_phone,
      null,false,false,false,
      'عميل وارد تلقائياً من WhatsApp — لم يُحدد نوع الطلب بعد',
      'cold','cold',20,'whatsapp','new',
      case when v_route='general' then null else p_assigned_to end,
      v_route,p_inbound_number,coalesce(p_message_at,now())
    ) returning id,assigned_to into v_client_id,v_effective_assigned;
    v_created := true;
  else
    v_client_id := v_client.id;
    update public.clients c
    set
      name = case
        when v_name is not null and (c.name is null or btrim(c.name)='' or c.name like 'عميل واتساب %')
        then v_name else c.name end,
      assigned_to = case
        when c.assigned_to is null and v_route<>'general' and p_assigned_to is not null then p_assigned_to
        else c.assigned_to end,
      lead_route = coalesce(c.lead_route,v_route),
      inbound_number = coalesce(c.inbound_number,p_inbound_number),
      last_contact_at = greatest(coalesce(c.last_contact_at,'-infinity'::timestamptz),coalesce(p_message_at,now())),
      archived=false,archived_at=null,archived_by=null
    where c.id=v_client_id
    returning assigned_to into v_effective_assigned;
  end if;

  return jsonb_build_object(
    'ok',true,
    'client_id',v_client_id,
    'created',v_created,
    'assigned_to',v_effective_assigned,
    'route_key',v_route
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_request_response_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  IF new.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.whatsapp_conversations w JOIN public.client_requests r ON r.id=new.request_id AND r.company_id=new.company_id WHERE w.id=new.conversation_id AND w.company_id=new.company_id AND (coalesce(w.route_key,'')='investment') IS DISTINCT FROM (coalesce(r.route_key,'')='investment' OR coalesce(r.branch_key,'')='investment')) THEN RETURN new;END IF;
  if tg_op='UPDATE' and new.request_id is not distinct from old.request_id then
    return new;
  end if;
  if new.request_id is null then return new; end if;

  if new.direction='outbound' and new.actor_type='human' then
    update public.client_requests r
    set first_human_response_at=coalesce(r.first_human_response_at,new.message_timestamp,new.created_at),
        last_contact_at=greatest(coalesce(r.last_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
    where r.id=new.request_id and r.company_id=new.company_id;
  elsif new.direction='inbound' then
    update public.client_requests r
    set first_mutual_dialogue_at = case
          when r.first_human_response_at is not null and r.first_mutual_dialogue_at is null
            and coalesce(new.message_timestamp,new.created_at) >= r.first_human_response_at
          then coalesce(new.message_timestamp,new.created_at)
          else r.first_mutual_dialogue_at end,
        last_mutual_contact_at = case
          when r.first_human_response_at is not null and coalesce(new.message_timestamp,new.created_at) >= r.first_human_response_at
          then greatest(coalesce(r.last_mutual_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
          else r.last_mutual_contact_at end,
        last_contact_at=greatest(coalesce(r.last_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
    where r.id=new.request_id and r.company_id=new.company_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_stale_requirement_prompt_on_new_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.direction='inbound' and new.client_id is not null then
    update public.client_requests
    set last_requirements_prompt_fields='{}'::text[]
    where company_id=new.company_id
      and client_id=new.client_id
      and status in ('active','paused')
      AND (coalesce(route_key,'')='investment' OR coalesce(branch_key,'')='investment') = EXISTS(SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=new.conversation_id AND w.company_id=new.company_id AND w.route_key='investment')
      and last_requirements_prompt_at is not null
      and last_requirements_prompt_at < now()-interval '24 hours';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.process_followup_reply_from_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event public.whatsapp_followup_events%rowtype;
  v_body text:=lower(trim(coalesce(new.body,new.transcript,'')));
  v_at timestamptz:=coalesce(new.message_timestamp,new.created_at,now());
begin
  -- Private investment follow-ups remain manual; never apply public consent/optout state.
  IF EXISTS(SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=new.conversation_id AND w.company_id=new.company_id AND w.route_key='investment') OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id AND c.lead_route='investment') THEN RETURN new;END IF;
  if new.direction<>'inbound' or new.client_id is null then return new; end if;

  select e.* into v_event
  from public.whatsapp_followup_events e
  where e.company_id=new.company_id and e.client_id=new.client_id
    AND NOT crm_repair_private.investment_link_is_private(new.company_id,to_jsonb(e))
    and e.status in ('sent','delivered','read') and e.sent_at is not null and e.sent_at<=v_at
    and e.sent_at>=v_at-interval '30 days'
  order by e.sent_at desc limit 1;
  if not found then return new; end if;

  update public.whatsapp_followup_events
  set status='responded',responded_at=v_at,updated_at=now()
  where id=v_event.id;

  update public.client_requests
  set last_contact_at=v_at,last_mutual_contact_at=coalesce(last_mutual_contact_at,v_at),updated_at=now()
  where id=v_event.request_id and company_id=new.company_id;

  -- Explicit global stop / unsubscribe.
  if v_body ~ '(توقف|وقف المتابعة|ايقاف المتابعة|إيقاف المتابعة|لا اريد المتابعة|لا أريد المتابعة|لا ترسل|لا تراسل|stop|unsubscribe)' then
    insert into public.whatsapp_followup_optouts(request_id,company_id,client_id,reason,source_message_id)
    select r.id,new.company_id,new.client_id,'customer_opt_out',new.id
    from public.client_requests r
    where r.company_id=new.company_id and r.client_id=new.client_id and r.status in ('active','paused') AND r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment'
    on conflict(request_id) do update set reason='customer_opt_out',source_message_id=excluded.source_message_id,created_at=now();
    update public.whatsapp_followup_optins set revoked_at=v_at,updated_at=now()
    where client_id=new.client_id and company_id=new.company_id and revoked_at is null;
    update public.client_requests set next_action='أوقف العميل المتابعة التلقائية',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused') AND route_key IS DISTINCT FROM 'investment' AND branch_key IS DISTINCT FROM 'investment';

  -- The consent prompt explicitly says the customer may answer فقط "لا". Respect it and do not ask again.
  elsif v_event.step='opt_in_request' and v_body ~ '^(لا|لا شكرا|لا شكر[اآ]?)$' then
    insert into public.whatsapp_followup_optouts(request_id,company_id,client_id,reason,source_message_id)
    select r.id,new.company_id,new.client_id,'declined_followup_opt_in',new.id
    from public.client_requests r
    where r.company_id=new.company_id and r.client_id=new.client_id and r.status in ('active','paused') AND r.route_key IS DISTINCT FROM 'investment' AND r.branch_key IS DISTINCT FROM 'investment'
    on conflict(request_id) do update set reason='declined_followup_opt_in',source_message_id=excluded.source_message_id,created_at=now();
    update public.client_requests set next_action='رفض العميل المتابعة التلقائية',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused') AND route_key IS DISTINCT FROM 'investment' AND branch_key IS DISTINCT FROM 'investment';

  elsif v_event.step='opt_in_request' and v_body ~ '(^|[[:space:]])(نعم|اي|أيوه|ايوه|هيه|موافق|موافقه|اوكي|أوكي|ok|yes)([[:space:]]|$)' then
    insert into public.whatsapp_followup_optins(client_id,company_id,consent_category,consent_text,source_message_id,source_conversation_id,consented_at,revoked_at)
    values(new.client_id,new.company_id,'property_request_followup','وافق العميل صراحة على تلقي متابعات طلبه العقاري عبر واتساب من أبناء حبيب للعقارات',new.id,new.conversation_id,v_at,null)
    on conflict(client_id) do update set consent_text=excluded.consent_text,source_message_id=excluded.source_message_id,source_conversation_id=excluded.source_conversation_id,consented_at=excluded.consented_at,revoked_at=null,updated_at=now();
    delete from public.whatsapp_followup_optouts o where company_id=new.company_id and client_id=new.client_id AND NOT crm_repair_private.investment_link_is_private(new.company_id,to_jsonb(o));
    update public.client_requests set next_action='المتابعة التلقائية مفعلة',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused') AND route_key IS DISTINCT FROM 'investment' AND branch_key IS DISTINCT FROM 'investment';

  -- Customer confirms they already found/bought a property.
  elsif v_body ~ '(حصلت|اشتريت|شريت|لقيت|وجدت).{0,20}(عقار|بيت|منزل|فيلا|شقة|ارض|أرض)|تم الشراء|خلاص اشتريت|خلاص شريت|انتهى البحث' then
    update public.client_requests
    set status='lost',search_status='bought_elsewhere',closed_reason='client_found_property',closed_at=v_at,
        next_action='إغلاق الطلب — العميل وجد عقاراً',updated_at=now()
    where id=v_event.request_id and company_id=new.company_id and status in ('active','paused');

  -- Customer is no longer searching, but did not say they bought elsewhere.
  elsif v_body ~ '(ما عاد ابحث|ما عاد أبحث|مو مهتم|غير مهتم|ما مهتم|وقفت البحث|أوقفت البحث|الغيت البحث|ألغيت البحث|خلاص ما اريد|خلاص ما أريد)' then
    update public.client_requests
    set status='paused',search_status='stopped',next_action='توقف العميل عن البحث',next_followup=null,updated_at=now()
    where id=v_event.request_id and company_id=new.company_id and status in ('active','paused');

  -- Positive reply means keep the request active.
  elsif v_event.step<>'opt_in_request' and v_body ~ '(^|[[:space:]])(نعم|اي|أيوه|ايوه|هيه|بعدني|ما زلت|لازلت|لسه|مهتم|ابحث|أبحث|ادور|أدور|مستمر)([[:space:]]|$)' then
    update public.client_requests
    set status='active',search_status='active',next_action='متابعة البحث للعميل',updated_at=now()
    where id=v_event.request_id and company_id=new.company_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_whatsapp_client_request(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_action text := lower(btrim(coalesce(p_action,'create')));
  v_req_type text := nullif(lower(btrim(coalesce(p_request->>'request_type',''))),'');
  v_property_type text := nullif(left(btrim(coalesce(p_request->>'property_type','')),120),'');
  v_property_types text[] := '{}'::text[];
  v_area text := nullif(left(btrim(coalesce(p_request->>'preferred_area','')),200),'');
  v_areas text[] := '{}'::text[];
  v_wilayat text := nullif(left(btrim(coalesce(p_request->>'wilayat','')),200),'');
  v_payment text := nullif(left(lower(btrim(coalesce(p_request->>'payment_method',''))),120),'');
  v_timing text := nullif(left(lower(btrim(coalesce(p_request->>'purchase_timing',''))),120),'');
  v_purpose text := nullif(left(lower(btrim(coalesce(p_request->>'purpose',''))),120),'');
  v_summary text := nullif(left(btrim(coalesce(p_request->>'request_summary','')),2000),'');
  v_close_reason text := nullif(left(btrim(coalesce(p_request->>'closed_reason','')),1000),'');
  v_close_outcome text := nullif(lower(btrim(coalesce(p_request->>'close_outcome',''))),'');
  v_fields jsonb := coalesce(p_request->'fields_present','[]'::jsonb);
  v_clear jsonb := coalesce(p_request->'clear_fields','[]'::jsonb);
  v_budget_min numeric;
  v_budget_max numeric;
  v_land_min numeric;
  v_land_max numeric;
  v_built_min numeric;
  v_built_max numeric;
  v_bedrooms integer;
  v_bathrooms integer;
  v_furnished boolean;
  v_confidence numeric;
  v_pair_tmp numeric;
  v_review boolean := false;
  v_score integer;
  v_temp text;
  v_request_id uuid;
  v_valid_existing boolean := false;
  v_relation text := 'mentioned';
begin
  IF p_existing_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.client_requests r WHERE r.id=p_existing_request_id AND r.company_id=p_company_id AND (coalesce(r.route_key,'')='investment' OR coalesce(r.branch_key,'')='investment') IS DISTINCT FROM (coalesce(p_route_key,'')='investment')) THEN
    RETURN jsonb_build_object('ok',true,'applied',false,'needs_human_review',true,'reason','request_route_compartment_mismatch');
  END IF;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id) then
    raise exception 'Invalid client';
  end if;

  if v_action not in ('create','update','close','pause','resume','none') then v_action := 'none'; end if;
  if v_req_type not in ('buyer','seller','tenant','landlord','consultation','investor') then v_req_type := 'consultation'; end if;

  begin v_budget_min := nullif(p_request->>'budget_min','')::numeric; exception when others then v_budget_min := null; end;
  begin v_budget_max := nullif(p_request->>'budget_max','')::numeric; exception when others then v_budget_max := null; end;
  begin v_land_min := nullif(p_request->>'land_size_min','')::numeric; exception when others then v_land_min := null; end;
  begin v_land_max := nullif(p_request->>'land_size_max','')::numeric; exception when others then v_land_max := null; end;
  begin v_built_min := nullif(p_request->>'built_size_min','')::numeric; exception when others then v_built_min := null; end;
  begin v_built_max := nullif(p_request->>'built_size_max','')::numeric; exception when others then v_built_max := null; end;
  begin v_bedrooms := nullif(p_request->>'bedrooms_min','')::integer; exception when others then v_bedrooms := null; end;
  begin v_bathrooms := nullif(p_request->>'bathrooms_min','')::integer; exception when others then v_bathrooms := null; end;
  begin v_furnished := nullif(p_request->>'furnished','')::boolean; exception when others then v_furnished := null; end;
  begin v_confidence := nullif(p_request->>'confidence','')::numeric; exception when others then v_confidence := null; end;
  begin v_review := coalesce((p_request->>'needs_human_review')::boolean,false); exception when others then v_review := true; end;

  -- Defensive normalization: AI/user input should not be able to violate pair constraints.
  if v_budget_min is not null and v_budget_max is not null and v_budget_min > v_budget_max then
    v_pair_tmp := v_budget_min; v_budget_min := v_budget_max; v_budget_max := v_pair_tmp;
    v_review := true;
  end if;
  if v_land_min is not null and v_land_max is not null and v_land_min > v_land_max then
    v_pair_tmp := v_land_min; v_land_min := v_land_max; v_land_max := v_pair_tmp;
    v_review := true;
  end if;
  if v_built_min is not null and v_built_max is not null and v_built_min > v_built_max then
    v_pair_tmp := v_built_min; v_built_min := v_built_max; v_built_max := v_pair_tmp;
    v_review := true;
  end if;

  if jsonb_typeof(p_request->'property_types')='array' then
    select coalesce(array_agg(left(btrim(t.value),120)) filter (where btrim(t.value)<>''), '{}'::text[])
    into v_property_types from jsonb_array_elements_text(p_request->'property_types') as t(value);
  end if;
  if jsonb_typeof(p_request->'preferred_areas')='array' then
    select coalesce(array_agg(left(btrim(t.value),200)) filter (where btrim(t.value)<>''), '{}'::text[])
    into v_areas from jsonb_array_elements_text(p_request->'preferred_areas') as t(value);
  end if;
  if v_property_type is null and cardinality(v_property_types)>0 then v_property_type := v_property_types[1]; end if;
  if v_area is null and cardinality(v_areas)>0 then v_area := v_areas[1]; end if;
  if cardinality(v_property_types)=0 and v_property_type is not null then v_property_types := array[v_property_type]; end if;
  if cardinality(v_areas)=0 and v_area is not null then v_areas := array[v_area]; end if;

  v_score := public.calc_client_request_score(p_request);
  v_temp := case when v_score>=65 then 'hot' when v_score>=35 then 'warm' else 'cold' end;

  if p_existing_request_id is not null then
    select exists(
      select 1 from public.client_requests r
      where r.id=p_existing_request_id and r.client_id=p_client_id and r.company_id=p_company_id
    ) into v_valid_existing;
  end if;

  if v_action='none' then
    return jsonb_build_object('ok',true,'applied',false,'needs_human_review',true,'reason','ambiguous_request');
  end if;

  if v_action='create' then
    insert into public.client_requests(
      company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,wilayat,
      budget_min,budget_max,payment_method,purchase_timing,purpose,
      bedrooms_min,bathrooms_min,land_size_min,land_size_max,built_size_min,built_size_max,furnished,
      status,pipeline_stage,source,source_detail,assigned_to,route_key,inbound_number,
      created_via,origin_whatsapp_message_id,ai_confidence,needs_human_review,ai_extracted,
      lead_score,lead_temperature,notes,last_contact_at
    ) values (
      p_company_id,p_client_id,v_req_type,v_property_type,v_property_types,v_area,v_areas,v_wilayat,
      v_budget_min,v_budget_max,v_payment,v_timing,v_purpose,
      v_bedrooms,v_bathrooms,v_land_min,v_land_max,v_built_min,v_built_max,v_furnished,
      'active','new','whatsapp','WhatsApp AI',
      case when coalesce(p_route_key,'general')='general' then null else p_assigned_to end,
      p_route_key,p_inbound_number,
      'whatsapp',p_message_id,v_confidence,v_review,p_request,
      v_score,v_temp,v_summary,coalesce(p_message_at,now())
    ) returning id into v_request_id;
    v_relation := 'created';

  elsif not v_valid_existing then
    return jsonb_build_object('ok',true,'applied',false,'needs_human_review',true,'reason','invalid_or_missing_existing_request');

  elsif v_action='close' then
    update public.client_requests r
    set
      status = case when v_close_outcome in ('won','lost','cancelled') then v_close_outcome else 'cancelled' end,
      closed_reason = coalesce(v_close_reason,v_summary,r.closed_reason),
      needs_human_review = r.needs_human_review or v_review,
      ai_confidence = coalesce(v_confidence,r.ai_confidence),
      ai_extracted = p_request,
      last_contact_at = coalesce(p_message_at,now()),
      route_key = coalesce(p_route_key,r.route_key),
      inbound_number = coalesce(p_inbound_number,r.inbound_number),
      assigned_to = case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end
    where r.id=p_existing_request_id
    returning id into v_request_id;
    v_relation := 'closed';

  elsif v_action='pause' then
    update public.client_requests r
    set status='paused',
        needs_human_review=r.needs_human_review or v_review,
        ai_confidence=coalesce(v_confidence,r.ai_confidence),ai_extracted=p_request,
        last_contact_at=coalesce(p_message_at,now()),
        assigned_to=case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end,
        route_key=coalesce(p_route_key,r.route_key),inbound_number=coalesce(p_inbound_number,r.inbound_number)
    where r.id=p_existing_request_id returning id into v_request_id;
    v_relation := 'updated';

  elsif v_action='resume' then
    update public.client_requests r
    set status='active',
        needs_human_review=r.needs_human_review or v_review,
        ai_confidence=coalesce(v_confidence,r.ai_confidence),ai_extracted=p_request,
        last_contact_at=coalesce(p_message_at,now()),
        assigned_to=case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end,
        route_key=coalesce(p_route_key,r.route_key),inbound_number=coalesce(p_inbound_number,r.inbound_number)
    where r.id=p_existing_request_id returning id into v_request_id;
    v_relation := 'updated';

  else
    update public.client_requests r
    set
      request_type = case when v_fields ? 'request_type' then v_req_type else r.request_type end,
      property_type = case when (v_clear ? 'property_types') or (v_clear ? 'property_type') then null when (v_fields ? 'property_types') or (v_fields ? 'property_type') then v_property_type else r.property_type end,
      property_types = case when (v_clear ? 'property_types') or (v_clear ? 'property_type') then '{}'::text[] when (v_fields ? 'property_types') or (v_fields ? 'property_type') then v_property_types else r.property_types end,
      preferred_area = case when (v_clear ? 'preferred_areas') or (v_clear ? 'preferred_area') then null when (v_fields ? 'preferred_areas') or (v_fields ? 'preferred_area') then v_area else r.preferred_area end,
      preferred_areas = case when (v_clear ? 'preferred_areas') or (v_clear ? 'preferred_area') then '{}'::text[] when (v_fields ? 'preferred_areas') or (v_fields ? 'preferred_area') then v_areas else r.preferred_areas end,
      wilayat = case when v_clear ? 'wilayat' then null when v_fields ? 'wilayat' then v_wilayat else r.wilayat end,
      budget_min = case when v_clear ? 'budget' then null when v_fields ? 'budget' then v_budget_min else r.budget_min end,
      budget_max = case when v_clear ? 'budget' then null when v_fields ? 'budget' then v_budget_max else r.budget_max end,
      payment_method = case when v_clear ? 'payment_method' then null when v_fields ? 'payment_method' then v_payment else r.payment_method end,
      purchase_timing = case when v_clear ? 'purchase_timing' then null when v_fields ? 'purchase_timing' then v_timing else r.purchase_timing end,
      purpose = case when v_clear ? 'purpose' then null when v_fields ? 'purpose' then v_purpose else r.purpose end,
      bedrooms_min = case when v_clear ? 'bedrooms_min' then null when v_fields ? 'bedrooms_min' then v_bedrooms else r.bedrooms_min end,
      bathrooms_min = case when v_clear ? 'bathrooms_min' then null when v_fields ? 'bathrooms_min' then v_bathrooms else r.bathrooms_min end,
      land_size_min = case when v_clear ? 'land_size' then null when v_fields ? 'land_size' then v_land_min else r.land_size_min end,
      land_size_max = case when v_clear ? 'land_size' then null when v_fields ? 'land_size' then v_land_max else r.land_size_max end,
      built_size_min = case when v_clear ? 'built_size' then null when v_fields ? 'built_size' then v_built_min else r.built_size_min end,
      built_size_max = case when v_clear ? 'built_size' then null when v_fields ? 'built_size' then v_built_max else r.built_size_max end,
      furnished = case when v_clear ? 'furnished' then null when v_fields ? 'furnished' then v_furnished else r.furnished end,
      needs_human_review = r.needs_human_review or v_review,
      ai_confidence = coalesce(v_confidence,r.ai_confidence),
      ai_extracted = p_request,
      lead_score = case when jsonb_array_length(v_fields)>0 then v_score else r.lead_score end,
      lead_temperature = case when jsonb_array_length(v_fields)>0 then v_temp else r.lead_temperature end,
      last_contact_at = coalesce(p_message_at,now()),
      route_key = coalesce(p_route_key,r.route_key),
      inbound_number = coalesce(p_inbound_number,r.inbound_number),
      assigned_to = case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end
    where r.id=p_existing_request_id
    returning id into v_request_id;
    v_relation := 'updated';
  end if;

  if v_request_id is not null and p_message_id is not null then
    insert into public.whatsapp_message_requests(company_id,message_id,request_id,relation)
    values(p_company_id,p_message_id,v_request_id,v_relation)
    on conflict (message_id,request_id) do update set relation=excluded.relation;
  end if;

  IF p_route_key IS DISTINCT FROM 'investment' OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.company_id=p_company_id AND c.lead_route='investment') THEN
    perform public.refresh_client_request_summary(p_client_id);
  END IF;

  return jsonb_build_object(
    'ok',true,'applied',v_request_id is not null,'request_id',v_request_id,
    'relation',v_relation,'needs_human_review',v_review,
    'lead_score',v_score,'lead_temperature',v_temp
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request_id uuid;
  v_inquiry_id uuid;
  v_deal_id uuid;
  v_current_stage text;
  v_target_stage text;
  v_price numeric;
  v_reason_code text;
  v_reason_id uuid;
  v_inquiry_status text;
  v_final boolean;
  v_candidate_count integer;
  v_workflow_context boolean:=false;
begin
  if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;

  v_request_id:=new.request_id;
  if v_request_id is null then
    select count(distinct pi.request_id), min(pi.request_id::text)::uuid into v_candidate_count,v_request_id
    from public.property_inquiries pi
    where pi.company_id=new.company_id and pi.client_id=new.client_id
      and pi.property_id=new.property_id and pi.request_id is not null
      AND EXISTS(SELECT 1 FROM public.client_requests rr JOIN public.clients cc ON cc.id=new.client_id AND cc.company_id=new.company_id WHERE rr.id=pi.request_id AND rr.company_id=new.company_id AND (coalesce(rr.route_key,'')='investment' OR coalesce(rr.branch_key,'')='investment')=coalesce(cc.lead_route='investment',false));
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if v_request_id is null then
    select count(*),min(cr.id::text)::uuid into v_candidate_count,v_request_id
    from public.client_requests cr
    where cr.company_id=new.company_id and cr.client_id=new.client_id and cr.status='active'
      AND (coalesce(cr.route_key,'')='investment' OR coalesce(cr.branch_key,'')='investment')=EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=new.client_id AND cc.company_id=new.company_id AND cc.lead_route='investment');
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if new.request_id is null and v_request_id is not null then
    update public.viewings set request_id=v_request_id where id=new.id and request_id is null;
  end if;

  if new.status='done' then
    if new.pipeline_outcome='lost' or (new.pipeline_outcome is null and new.client_feedback='disliked') then
      v_target_stage:='lost'; v_inquiry_status:='not_suitable';
    elsif new.pipeline_outcome='negotiation' or (new.pipeline_outcome is null and new.client_feedback='wants_negotiate') then
      v_target_stage:='negotiation'; v_inquiry_status:='negotiation';
    else
      v_target_stage:='visit'; v_inquiry_status:='viewed';
    end if;
  elsif new.status='postponed' then
    v_target_stage:='viewing_postponed'; v_inquiry_status:='followup';
  elsif new.status='no_show' then
    v_target_stage:='viewing_no_show'; v_inquiry_status:='followup';
  elsif new.status='cancelled' then
    v_target_stage:='viewing_cancelled'; v_inquiry_status:='followup';
  else
    v_target_stage:='viewing_scheduled'; v_inquiry_status:='viewing_scheduled';
  end if;

  select pi.id into v_inquiry_id
  from public.property_inquiries pi
  where pi.company_id=new.company_id and pi.client_id=new.client_id and pi.property_id=new.property_id
    and pi.request_id IS NOT DISTINCT FROM v_request_id
  order by case when pi.request_id=v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
  limit 1;

  if v_inquiry_id is null and new.status<>'cancelled' then
    insert into public.property_inquiries(
      company_id,client_id,property_id,assigned_to,source,source_detail,status,
      first_inquiry_at,last_inquiry_at,inquiry_count,created_by,request_id,
      shown_by_agent,match_status,viewing_booked,viewing_completed,post_visit_interest,outcome,
      rejection_reason,rejection_notes,last_contact_at,followup_note,next_followup,has_inbound_inquiry
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,'other','زيارة/معاينة مسجلة في CRM',v_inquiry_status,
      coalesce(new.created_at,now()),now(),1,new.created_by,v_request_id,
      true,'matched',true,(new.status='done'),new.client_feedback,
      case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else null end,
      new.rejection_reason,nullif(btrim(new.outcome_note),''),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  elsif v_inquiry_id is not null then
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=exists(select 1 from public.viewings vx where vx.company_id=new.company_id and vx.client_id=new.client_id and vx.property_id=new.property_id and vx.archived=false and vx.status='done' and vx.request_id IS NOT DISTINCT FROM v_request_id),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') else rejection_notes end,
      last_contact_at=now(),
      followup_note=coalesce(new.next_step,followup_note),
      next_followup=coalesce(new.followup_date,next_followup),
      updated_at=now()
    where id=v_inquiry_id;
  end if;

  v_reason_code:=case coalesce(new.rejection_reason,'')
    when 'price' then 'price_value_mismatch'
    when 'location' then 'location'
    when 'area' then 'built_size'
    when 'room_layout' then 'layout'
    when 'design' then 'layout'
    when 'finishing' then 'finishing'
    when 'parking' then 'yard_parking'
    when 'financing' then 'finance_not_ready'
    when 'found_other' then 'chose_other_property'
    when 'no_response' then 'no_response_after_visit'
    when 'not_serious' then 'client_not_ready'
    when 'not_interested' then 'not_interested'
    when 'other' then 'no_clear_reason'
    when 'no_clear_reason' then 'no_clear_reason'
    else null end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and company_id=new.company_id and is_active=true;

  if v_target_stage='lost' and v_reason_id is not null then
    perform crm_repair_private.set_primary_rejection(
      new.company_id,new.client_id,new.property_id,v_request_id,v_inquiry_id,
      v_reason_id,new.outcome_note,'post_visit',new.created_by);
  end if;

  -- Only the already-authorized atomic deal save can populate this private transaction context.
  -- It preserves an existing card's identity while a new real visit resolves its previously missing request.
  select d.id,d.stage into v_deal_id,v_current_stage
  from crm_repair_private.deal_workflow_context ctx
  join public.deals d on d.id=ctx.deal_id and d.company_id=ctx.company_id
   and d.client_id=ctx.client_id and d.property_id=ctx.property_id
  where ctx.transaction_id=txid_current() and ctx.user_id=auth.uid()
   and ctx.company_id=new.company_id and ctx.client_id=new.client_id and ctx.property_id=new.property_id;
  v_workflow_context:=v_deal_id is not null;
  if not v_workflow_context then
  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and d.request_id IS NOT DISTINCT FROM v_request_id
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  end if;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=nullif(btrim(new.outcome_note),''),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=null,lost_reason_note=null,lost_from_stage=null,lost_at=null,closed_at=null,updated_at=now()
        where id=v_deal_id;
      else
        update public.deals set
          stage=case
            when v_target_stage='negotiation' then 'negotiation'
            when v_target_stage='visit' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit') then 'visit'
            when v_target_stage='viewing_postponed' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_postponed'
            when v_target_stage='viewing_no_show' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_no_show'
            when v_target_stage='viewing_cancelled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_cancelled'
            when v_target_stage='viewing_scheduled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_scheduled'
            else v_current_stage end,
          viewing_id=new.id,
          request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- SQL18 companion: append after investment_row_allowed is installed.
-- Keep the live RPC signatures, grants, finance masking, and Muscat/Barka predicates.
-- These existing definer surfaces require explicit guards because they bypass RLS.
-- The parent migration captures their exact original definitions before this file runs.

CREATE OR REPLACE VIEW public.crm_properties_access AS
 SELECT id,
    company_id,
    added_by,
    title,
    type,
    area,
    price,
    bedrooms,
    bathrooms,
    land_size,
    built_size,
    status,
    description,
    images,
    views_count,
    inquiries_count,
    created_at,
    updated_at,
    owner_client_id,
    archived,
    archived_at,
    archived_by,
    owner_id,
        CASE
            WHEN my_role() = 'owner'::text THEN owner_net
            ELSE NULL::numeric
        END AS owner_net,
    wilayat,
    source_type,
    marketing_status,
        CASE
            WHEN my_role() = 'owner'::text THEN expected_commission
            ELSE NULL::numeric
        END AS expected_commission,
    property_code,
    internal_name,
    branch_key,
    availability_checked_at,
    performance_tracking_started_at,
    photography_status,
    photography_reason,
    photography_required_at,
    photography_completed_at,
    marketing_review_status,
    marketing_reviewed_at,
    marketing_review_note,
    last_ai_recommendation,
    last_ai_recommendation_at,
    public_details,
    map_url,
    has_listing_agreement,
    agreement_start_date,
    agreement_duration_months,
    agreement_end_date,
    agreement_reminder_days,
    sourced_by
   FROM properties t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t)) AND crm_repair_private.staff_can_access_branch(company_id, branch_key);

CREATE OR REPLACE VIEW public.crm_deals_access AS
 SELECT id,
    company_id,
    client_id,
    property_id,
    agent_id,
    stage,
    deal_value,
    deposit_amount,
    closing_probability,
    expected_close_date,
    bank_financing,
    notes,
    closed_at,
        CASE
            WHEN my_role() = 'owner'::text THEN company_commission
            ELSE NULL::numeric
        END AS company_commission,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_commission
            ELSE NULL::numeric
        END AS agent_commission,
    created_at,
    updated_at,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_total
            ELSE NULL::numeric
        END AS commission_total,
        CASE
            WHEN my_role() = 'owner'::text THEN company_share
            ELSE NULL::numeric
        END AS company_share,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_share
            ELSE NULL::numeric
        END AS agent_share,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_status
            ELSE NULL::text
        END AS commission_status,
    broker_id,
        CASE
            WHEN my_role() = 'owner'::text THEN broker_commission
            ELSE NULL::numeric
        END AS broker_commission,
    request_id,
    viewing_id,
    lost_reason_id,
    lost_reason_note,
    lost_from_stage,
    lost_at,
    entry_mode,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_received_at
            ELSE NULL::timestamp with time zone
        END AS commission_received_at,
        CASE
            WHEN my_role() = 'owner'::text THEN employee_commission_percent
            ELSE NULL::numeric
        END AS employee_commission_percent
   FROM deals t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t)) AND (property_id IS NULL OR (EXISTS ( SELECT 1
           FROM properties p
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.investment_row_allowed(p.company_id, to_jsonb(p)) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id)));

CREATE OR REPLACE FUNCTION public.crm_employee_performance(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.my_company(); v_actor uuid:=auth.uid(); v_role text:=public.my_role();
 v_start timestamptz;v_end timestamptz;v_result jsonb;v_inception date;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then
  raise exception using errcode='42501',message='performance_not_allowed';
 end if;
 -- Company row creation is not the beginning of the historical business ledger.
 select least((c.created_at at time zone 'Asia/Muscat')::date,(
   select min((hd.closed_at at time zone 'Asia/Muscat')::date)
   from public.deals hd where crm_repair_private.investment_row_allowed(hd.company_id,to_jsonb(hd)) and hd.company_id=c.id and hd.stage in('closed','commission_collected')
    and (v_role<>'agent' or (hd.agent_id=v_actor
      and crm_repair_private.can_access_client(hd.company_id,hd.client_id)
      and (hd.property_id is null or exists(select 1 from public.properties hp where crm_repair_private.investment_row_allowed(hp.company_id,to_jsonb(hp)) and hp.id=hd.property_id and hp.company_id=hd.company_id and crm_repair_private.staff_can_access_branch(hp.company_id,hp.branch_key)))))
 )) into v_inception from public.companies c where c.id=v_company;
 if p_from is null then p_from:=v_inception;end if;
 if p_from is null or p_to is null or p_to<=p_from then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(v.to_sale,0),
   'sales',coalesce(d.sales,0),
   'company_commission',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),
   'outbound_messages',coalesce(w.outbound,0),
   'targets',jsonb_build_object('inventory_target',10)||coalesce(to_jsonb(t)-'company_id'-'employee_id'-'month_start'-'updated_at','{}'::jsonb)
 )),'[]'::jsonb) into v_result
 from public.profiles e
 left join public.employee_monthly_targets t on t.company_id=e.company_id and t.employee_id=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   select count(*) filter(where p.archived=false and p.status not in('sold','not_available')) active_inventory,
    count(*) filter(where p.created_at>=v_start and p.created_at<v_end) new_properties
   from public.properties p where crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p)) and p.company_id=e.company_id and crm_repair_private.performance_employee(p.company_id,p.branch_key,p.created_at,p.sourced_by)=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi)) and pi.company_id=e.company_id and crm_repair_private.performance_employee(pi.company_id,(select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=pi.property_id and pp.company_id=pi.company_id),pi.first_inquiry_at,pi.assigned_to)=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to
      and exists(select 1 from public.deals dd where crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and dd.company_id=vv.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
        and dd.client_id=vv.client_id and dd.property_id=vv.property_id
        and dd.stage in('closed','commission_collected') and dd.closed_at>=vv.viewing_date::timestamp at time zone 'Asia/Muscat')) to_sale
   from public.viewings vv where crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and vv.company_id=e.company_id and crm_repair_private.performance_employee(vv.company_id,(select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=vv.property_id and pp.company_id=vv.company_id),vv.created_at,vv.agent_id)=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   select count(*) sales,sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and dd.company_id=e.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where crm_repair_private.investment_row_allowed(aa.company_id,to_jsonb(aa)) and aa.company_id=e.company_id and crm_repair_private.performance_employee(aa.company_id,coalesce((select pp.branch_key from public.properties pp where crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and cc.id=aa.client_id and cc.company_id=aa.company_id)),coalesce(aa.occurred_at,aa.created_at),aa.user_id)=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   select count(*) outbound from public.whatsapp_messages mm
   where crm_repair_private.investment_row_allowed(mm.company_id,to_jsonb(mm)) and mm.company_id=e.company_id and crm_repair_private.performance_employee(mm.company_id,(select wc.route_key from public.whatsapp_conversations wc where crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc)) and wc.id=mm.conversation_id and wc.company_id=mm.company_id),mm.message_timestamp,mm.sent_by_user_id)=e.id and mm.direction='outbound' and mm.actor_type='human' and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(mm.company_id,mm.conversation_id))
    and mm.message_timestamp>=v_start and mm.message_timestamp<v_end
 ) w on true
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_mark_instagram_read(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.instagram_conversations%rowtype; m public.instagram_messages%rowtype; n int;
 v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT ic.* INTO c FROM public.instagram_conversations ic WHERE ic.id=p_conversation_id AND ic.company_id=v_company
  AND crm_repair_private.investment_row_allowed(ic.company_id,to_jsonb(ic))
  AND (v_role IN ('owner','manager') OR ic.assigned_to=auth.uid() OR EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=ic.client_id AND cc.company_id=v_company AND cc.assigned_to=auth.uid()
    AND crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)))) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT im.* INTO m FROM public.instagram_messages im WHERE im.id=p_message_id AND im.conversation_id=c.id AND im.company_id=v_company
  AND crm_repair_private.investment_row_allowed(im.company_id,to_jsonb(im));
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.instagram_messages im WHERE im.conversation_id=c.id AND im.company_id=v_company AND im.direction='inbound' AND im.ingestion_seq>c.read_through_seq
  AND crm_repair_private.investment_row_allowed(im.company_id,to_jsonb(im));
 UPDATE public.instagram_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $function$;

CREATE OR REPLACE FUNCTION public.crm_public_business_routes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('route_key',route_key,'label',label,'whatsapp_number',whatsapp_number) ORDER BY route_key),'[]'::jsonb) INTO result
 FROM public.company_lead_routes WHERE company_id=v_company AND is_active AND nullif(trim(whatsapp_number),'') IS NOT NULL
 AND (v_role='owner' OR route_key IS DISTINCT FROM 'investment')
 AND (v_role IN ('owner','manager') OR NOT coalesce(owner_only_inbox,false));
 RETURN result;
END $function$;

-- SQL18 attribution companion. Keep existing exact evidence, locking and RLS contracts.
-- A contact may keep ordinary branch history while receiving separate private investment work.
-- No production row rewrite: these narrow guards affect future attribution writes only.
-- Backup/restore both function definitions in the parent SQL18 migration.

CREATE OR REPLACE FUNCTION public.record_property_link_inquiry_internal(p_company_id uuid, p_client_id uuid, p_property_id uuid, p_marketing_event_id uuid, p_whatsapp_message_id uuid, p_raw_url text, p_link_key text, p_message_at timestamp with time zone, p_manual boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_attr public.property_message_attributions%rowtype; v_inq public.property_inquiries%rowtype;
 v_request uuid; v_assigned uuid; v_source text; v_private boolean:=false; v_client_route text; v_message public.whatsapp_messages%rowtype; v_property public.properties%rowtype; v_at timestamptz:=coalesce(p_message_at,now());
BEGIN
 -- Serialize messages from one client without assuming their other requests match this property.
 SELECT assigned_to,lead_route INTO v_assigned,v_client_route FROM public.clients WHERE id=p_client_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id AND direction='inbound')
 THEN RAISE EXCEPTION 'invalid_attribution_relationship'; END IF;
 SELECT * INTO v_message FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id;
 v_private:=coalesce(v_client_route='investment',false) OR EXISTS(
  SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=v_message.conversation_id AND w.company_id=p_company_id AND w.route_key='investment');
 IF v_private THEN v_assigned:=crm_repair_private.investment_owner(p_company_id);END IF;
 IF p_marketing_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id AND property_id=p_property_id)
 THEN RAISE EXCEPTION 'invalid_marketing_relationship'; END IF;
 SELECT * INTO v_attr FROM public.property_message_attributions WHERE company_id=p_company_id AND message_id=p_whatsapp_message_id AND property_id=p_property_id;
 IF FOUND THEN RETURN v_attr.inquiry_id; END IF;
 SELECT r.id INTO v_request FROM public.client_requests r WHERE company_id=p_company_id AND client_id=p_client_id AND subject_property_id=p_property_id AND status='active'
 AND v_private=(coalesce(r.route_key='investment',false) OR coalesce(r.branch_key='investment',false)) ORDER BY created_at LIMIT 1;
 -- A private message must acquire a private request before creating/updating any inquiry.
 -- In particular, never re-use the ordinary branch's property inquiry for a shared phone.
 IF v_private AND v_request IS NULL THEN
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id AND company_id=p_company_id;
  INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
   assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
  VALUES(p_company_id,p_client_id,'investor',v_property.type,CASE WHEN v_property.type IS NULL THEN '{}'::text[] ELSE ARRAY[v_property.type] END,
   v_property.area,ARRAY[v_property.area],p_property_id,v_assigned,'investment','investment',v_message.recipient_wa_id,
   'whatsapp','استفسار استثماري عن عقار محدد عبر واتساب','whatsapp',v_message.id,true,
   'مراجعة الاستفسار الاستثماري وتأكيد الميزانية والتوقيت','تم تحديد العقار من دليل الرسالة؛ لا تعتبر بيانات الإعلان متطلبات صرح بها العميل') RETURNING id INTO v_request;
 END IF;
 SELECT * INTO v_inq FROM public.property_inquiries WHERE company_id=p_company_id AND client_id=p_client_id AND property_id=p_property_id
 AND request_id IS NOT DISTINCT FROM v_request ORDER BY created_at LIMIT 1 FOR UPDATE;
 SELECT CASE channel WHEN 'instagram' THEN 'instagram' WHEN 'youtube' THEN 'youtube' ELSE 'whatsapp' END INTO v_source
 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id;
 v_source:=coalesce(v_source,'whatsapp');
 IF v_inq.id IS NOT NULL THEN
   UPDATE public.property_inquiries SET has_inbound_inquiry=true,
    source=CASE WHEN NOT has_inbound_inquiry OR source='other' THEN v_source ELSE source END,
    source_detail=CASE WHEN p_manual THEN 'تحديد العقار بمراجعة الموظف' ELSE 'استفسار وارد عن عقار محدد' END,
    source_url=p_raw_url,source_whatsapp_message_id=p_whatsapp_message_id,
    marketing_event_id=coalesce(p_marketing_event_id,marketing_event_id),
    last_inquiry_at=greatest(last_inquiry_at,v_at),
    inquiry_count=CASE WHEN has_inbound_inquiry THEN inquiry_count+1 ELSE 1 END,last_message=left(p_raw_url,6000),updated_at=now()
   WHERE id=v_inq.id RETURNING * INTO v_inq;
 ELSE
   INSERT INTO public.property_inquiries(company_id,client_id,property_id,assigned_to,source,source_detail,status,first_inquiry_at,last_inquiry_at,
    inquiry_count,last_message,request_id,is_first_attraction,shown_by_agent,has_inbound_inquiry,marketing_event_id,source_url,source_whatsapp_message_id)
   VALUES(p_company_id,p_client_id,p_property_id,v_assigned,v_source,'استفسار وارد عن عقار محدد','inquiry',v_at,v_at,1,left(p_raw_url,6000),v_request,
    NOT EXISTS(SELECT 1 FROM public.property_inquiries pi WHERE pi.company_id=p_company_id AND pi.client_id=p_client_id AND pi.has_inbound_inquiry
     AND v_private=(coalesce(v_client_route='investment',false)
       OR EXISTS(SELECT 1 FROM public.client_requests r WHERE r.id=pi.request_id AND r.company_id=pi.company_id AND (r.route_key='investment' OR r.branch_key='investment'))
       OR EXISTS(SELECT 1 FROM public.whatsapp_messages sm JOIN public.whatsapp_conversations sw ON sw.id=sm.conversation_id AND sw.company_id=sm.company_id
          WHERE sm.id=pi.source_whatsapp_message_id AND sm.company_id=pi.company_id AND sw.route_key='investment')))
   ,false,true,p_marketing_event_id,p_raw_url,p_whatsapp_message_id)
   RETURNING * INTO v_inq;
 END IF;
 INSERT INTO public.property_message_attributions(company_id,message_id,client_id,property_id,marketing_event_id,inquiry_id,request_id,evidence_key,source_url,method)
 VALUES(p_company_id,p_whatsapp_message_id,p_client_id,p_property_id,p_marketing_event_id,v_inq.id,v_request,p_link_key,p_raw_url,
 CASE WHEN p_manual THEN 'manual' WHEN p_link_key LIKE 'property-code:%' THEN 'exact_code' WHEN p_link_key LIKE 'ai-property:%' THEN 'ai_verified' ELSE 'exact_link' END);
 RETURN v_inq.id;
END $function$;

CREATE OR REPLACE FUNCTION public.crm_finalize_property_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.whatsapp_messages%rowtype; a public.property_message_attributions%rowtype;
 p public.properties%rowtype; c public.clients%rowtype; v_req uuid; v_reqcount int; v_propcount int; v_inq uuid; v_n int:=0; v_type text; v_private boolean:=false; v_assigned uuid;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION 'inbound_message_required'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_message_client'; END IF;
 v_private:=coalesce(c.lead_route='investment',false) OR EXISTS(
  SELECT 1 FROM public.whatsapp_conversations w WHERE w.id=m.conversation_id AND w.company_id=m.company_id AND w.route_key='investment');
 v_assigned:=CASE WHEN v_private THEN crm_repair_private.investment_owner(m.company_id) ELSE c.assigned_to END;
 SELECT count(*) INTO v_propcount FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id;
 FOR a IN SELECT * FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id ORDER BY property_id LOOP
  IF a.request_id IS NOT NULL THEN
   IF v_private THEN
    IF NOT EXISTS(SELECT 1 FROM public.client_requests r WHERE r.id=a.request_id AND r.company_id=m.company_id AND r.client_id=m.client_id
      AND (r.route_key='investment' OR r.branch_key='investment')) THEN RAISE EXCEPTION 'investment_attribution_request_mismatch';END IF;
    INSERT INTO public.whatsapp_message_requests(company_id,message_id,request_id,relation)
    VALUES(m.company_id,m.id,a.request_id,'mentioned') ON CONFLICT(message_id,request_id) DO NOTHING;
   END IF;
   CONTINUE;
  END IF;
  SELECT * INTO p FROM public.properties WHERE id=a.property_id AND company_id=m.company_id;
  SELECT id INTO v_req FROM public.client_requests WHERE company_id=m.company_id AND client_id=m.client_id AND subject_property_id=p.id AND status='active'
    AND v_private=(coalesce(route_key='investment',false) OR coalesce(branch_key='investment',false)) ORDER BY created_at LIMIT 1;
  IF v_req IS NULL AND v_propcount=1 THEN
   SELECT count(*),(array_agg(r.id))[1] INTO v_reqcount,v_req FROM public.client_requests r JOIN public.whatsapp_message_requests w ON w.request_id=r.id
   WHERE w.message_id=m.id AND w.company_id=m.company_id AND r.client_id=m.client_id AND r.company_id=m.company_id AND r.status='active'
    AND r.request_type IN ('buyer','tenant','investor') AND (r.subject_property_id IS NULL OR r.subject_property_id=p.id)
    AND v_private=(coalesce(r.route_key='investment',false) OR coalesce(r.branch_key='investment',false));
   IF v_reqcount<>1 THEN v_req:=NULL; END IF;
  END IF;
  IF v_req IS NULL THEN
   -- Do not infer financing, budget, readiness or bedrooms from a listing's price/specification.
   v_type:=CASE WHEN v_private THEN 'investor' WHEN coalesce(m.body,'') ~ '(استئجار|للايجار|للإيجار|rent)' THEN 'tenant' ELSE 'buyer' END;
   INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
    assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
   VALUES(m.company_id,m.client_id,v_type,p.type,CASE WHEN p.type IS NULL THEN '{}'::text[] ELSE ARRAY[p.type] END,p.area,ARRAY[p.area],p.id,
    v_assigned,CASE WHEN v_private THEN 'investment' ELSE coalesce(p.branch_key,c.lead_route,'general') END,
    CASE WHEN v_private THEN 'investment' ELSE coalesce(p.branch_key,c.lead_route,'general') END,m.recipient_wa_id,
    CASE WHEN a.evidence_key LIKE 'instagram%' THEN 'instagram' ELSE 'whatsapp' END,'استفسار عن عقار محدد عبر واتساب','whatsapp',m.id,true,
    'مراجعة الاستفسار وتأكيد نوع الطلب والميزانية والتوقيت','تم تحديد العقار من دليل الرسالة؛ لا تعتبر بيانات الإعلان متطلبات صرح بها العميل') RETURNING id INTO v_req;
  ELSE
   UPDATE public.client_requests SET subject_property_id=coalesce(subject_property_id,p.id) WHERE id=v_req AND company_id=m.company_id;
  END IF;
  -- Reuse the inquiry already belonging to the selected request; preserve legacy rows and their history.
  SELECT id INTO v_inq FROM public.property_inquiries WHERE company_id=m.company_id AND request_id=v_req AND property_id=p.id LIMIT 1;
  IF v_inq IS NULL THEN
   UPDATE public.property_inquiries SET request_id=v_req WHERE id=a.inquiry_id AND company_id=m.company_id AND request_id IS NULL RETURNING id INTO v_inq;
  END IF;
  UPDATE public.property_message_attributions SET request_id=v_req,inquiry_id=coalesce(v_inq,inquiry_id) WHERE id=a.id;
  INSERT INTO public.whatsapp_message_requests(company_id,message_id,request_id,relation) VALUES(m.company_id,m.id,v_req,'mentioned') ON CONFLICT(message_id,request_id) DO NOTHING;
  v_n:=v_n+1;
 END LOOP;
 SELECT count(DISTINCT request_id),(array_agg(DISTINCT request_id))[1] INTO v_reqcount,v_req FROM public.whatsapp_message_requests WHERE message_id=m.id AND company_id=m.company_id;
 IF v_reqcount=1 THEN UPDATE public.whatsapp_messages SET request_id=v_req WHERE id=m.id; END IF;
 RETURN jsonb_build_object('ok',true,'linked_count',v_n,'property_count',v_propcount);
END $function$;
