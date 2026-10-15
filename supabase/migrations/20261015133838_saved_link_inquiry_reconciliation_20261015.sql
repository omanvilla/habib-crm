-- Reconcile a newly saved exact listing link with earlier inbound references.
-- No production row backfill is performed by this schema change.
-- Every match uses the existing unique saved link; no AI/geographic guess.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION crm_repair_private.reconcile_saved_property_link(p_event_id uuid,p_message_ids uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE e public.property_marketing_events%rowtype; p public.properties%rowtype;
 actor public.profiles%rowtype; u record; n integer:=0; total_matches integer; first_property uuid; first_event uuid;
 parent_before jsonb; parent_after jsonb;
 trusted_backend boolean:=auth.uid() IS NULL AND
  (current_setting('role',true) IN ('service_role','postgres') OR
   (session_user='postgres' AND current_setting('role',true)='none'));
BEGIN
 -- This private helper is not a public RPC. Trigger calls still check the real
 -- actor; an ordinary employee saving a link cannot mutate another inbox.
 SELECT * INTO e FROM public.property_marketing_events WHERE id=p_event_id;
 IF NOT FOUND OR e.link_key IS NULL OR public.normalize_property_marketing_link(e.url) IS DISTINCT FROM e.link_key THEN RETURN 0;END IF;
 SELECT * INTO p FROM public.properties WHERE id=e.property_id AND company_id=e.company_id;
 IF NOT FOUND OR (SELECT count(*) FROM public.property_marketing_events x WHERE x.company_id=e.company_id AND x.link_key=e.link_key)<>1 THEN RETURN 0;END IF;
 IF NOT trusted_backend THEN
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND company_id=e.company_id AND is_active=true;
  IF NOT FOUND OR actor.role NOT IN ('owner','manager','agent') THEN RETURN 0;END IF;
  IF NOT crm_repair_private.staff_can_access_branch(e.company_id,p.branch_key)
    OR NOT crm_repair_private.investment_row_allowed(e.company_id,to_jsonb(p)) THEN RETURN 0;END IF;
 END IF;

 FOR u IN
  SELECT pending.*,m.message_timestamp,m.created_at AS message_created_at,c.route_key,c.client_id AS conversation_client_id
  FROM public.unmatched_property_links pending
  JOIN public.whatsapp_messages m ON m.id=pending.whatsapp_message_id AND m.company_id=pending.company_id
    AND m.client_id=pending.client_id AND m.conversation_id=pending.conversation_id AND m.direction='inbound'
  JOIN public.whatsapp_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id AND c.client_id=m.client_id
  JOIN public.clients parent ON parent.id=m.client_id AND parent.company_id=m.company_id
  WHERE pending.company_id=e.company_id AND pending.link_key=e.link_key AND pending.status='pending'
    AND (p_message_ids IS NULL OR m.id=ANY(p_message_ids))
    AND public.normalize_property_marketing_link(pending.raw_url)=e.link_key
    -- Keep a branch-line inquiry inside that branch. Investment stays private
    -- through the existing request/inquiry attribution guards.
    AND (c.route_key=p.branch_key OR c.route_key='investment')
    -- Late attribution must not reassign a legacy/shared parent through the
    -- normal request-summary triggers. Conflicting identity stays for review.
    AND (c.route_key='investment' OR (parent.lead_route=c.route_key AND EXISTS(
      SELECT 1 FROM public.company_lead_routes route WHERE route.company_id=e.company_id
        AND route.route_key=c.route_key AND route.is_active=true AND route.assigned_to=parent.assigned_to)))
    AND (trusted_backend OR
      (crm_repair_private.can_access_whatsapp_conversation(e.company_id,c.id)
       AND crm_repair_private.investment_row_allowed(e.company_id,to_jsonb(pending))))
  ORDER BY pending.client_id,m.message_timestamp,m.id,pending.id
  FOR UPDATE OF pending
 LOOP
  -- A single conflicting historical identity must stay pending without aborting
  -- the link save or mutating its parent. Roll back only this message's work.
  BEGIN
  SELECT to_jsonb(c) INTO parent_before FROM public.clients c WHERE c.id=u.client_id AND c.company_id=e.company_id FOR UPDATE;
  -- The internal recorder locks the client and is idempotent by message/property.
  -- Use the original business timestamp, never the time the link was saved.
  PERFORM public.record_property_link_inquiry_internal(e.company_id,u.client_id,e.property_id,e.id,
    u.whatsapp_message_id,u.raw_url,u.link_key,coalesce(u.message_timestamp,u.message_created_at),false);
  PERFORM public.crm_finalize_property_message(u.whatsapp_message_id);
  SELECT to_jsonb(c) INTO parent_after FROM public.clients c WHERE c.id=u.client_id AND c.company_id=e.company_id;
  IF parent_after IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['lead_route','assigned_to','name','phone','phone_normalized','created_at']) fields(field_name)
    WHERE parent_before->fields.field_name IS DISTINCT FROM parent_after->fields.field_name) THEN
   RAISE EXCEPTION USING ERRCODE='P8210',MESSAGE='saved_link_parent_identity_conflict';
  END IF;
  -- A verified sale inquiry may fill an absent buyer classification through the
  -- existing request-summary behavior. Never replace a prior classification,
  -- infer a rental, or classify a listing whose sale context is not explicit.
  IF parent_before->'client_type' IS DISTINCT FROM parent_after->'client_type' AND NOT(
    nullif(btrim(parent_before->>'client_type'),'') IS NULL AND parent_after->>'client_type'='buyer'
    AND concat_ws(' ',p.title,p.description,p.public_details) ~* '(للبيع|for sale)'
    AND concat_ws(' ',p.title,p.description,p.public_details) !~* '(للإيجار|للايجار|للاستئجار|for rent|rental|rent)') THEN
   RAISE EXCEPTION USING ERRCODE='P8210',MESSAGE='saved_link_parent_identity_conflict';
  END IF;
  UPDATE public.unmatched_property_links SET status='resolved',property_id=e.property_id,marketing_event_id=e.id,
    resolved_by=NULL,resolved_at=now(),updated_at=now() WHERE id=u.id AND status='pending';
  SELECT count(*),(array_agg(a.property_id ORDER BY a.created_at,a.id))[1],
    (array_agg(a.marketing_event_id ORDER BY a.created_at,a.id))[1]
    INTO total_matches,first_property,first_event
    FROM public.property_message_attributions a WHERE a.company_id=e.company_id AND a.message_id=u.whatsapp_message_id;
  UPDATE public.whatsapp_messages SET matched_property_id=first_property,matched_marketing_event_id=first_event,
    property_match_status=CASE
      WHEN EXISTS(SELECT 1 FROM public.unmatched_property_links pending WHERE pending.company_id=e.company_id
        AND pending.whatsapp_message_id=u.whatsapp_message_id AND pending.status='pending') THEN 'partial_match'
      WHEN total_matches>1 THEN 'multiple_matched' ELSE 'auto_matched' END,
    property_link_key=CASE WHEN total_matches=1 THEN e.link_key ELSE NULL END
    WHERE id=u.whatsapp_message_id AND company_id=e.company_id;
  n:=n+1;
  EXCEPTION WHEN SQLSTATE 'P8210' THEN
   -- The subtransaction also undoes requests, inquiry counts and history rows.
   -- Do not catch database/permission errors: those must surface for repair.
   CONTINUE;
  END;
 END LOOP;
 RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.reconcile_saved_property_link(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_repair_private.reconcile_saved_property_link(uuid,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.reconcile_property_link_after_save()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 PERFORM crm_repair_private.reconcile_saved_property_link(new.id);
 RETURN new;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.reconcile_property_link_after_save() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER reconcile_property_link_after_save
AFTER INSERT OR UPDATE OF url,link_key,property_id ON public.property_marketing_events
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.reconcile_property_link_after_save();

