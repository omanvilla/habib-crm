-- Draft for reviewed deployment. No production data UPDATE/DELETE/backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS crm_repair_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA crm_repair_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA crm_repair_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_company()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT p.company_id FROM public.profiles p
       WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $$;
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT p.role FROM public.profiles p
       WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $$;
REVOKE ALL ON FUNCTION public.my_company(), public.my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company(), public.my_role() TO authenticated, service_role;

-- Internal trigger calls still execute as their postgres owner. No direct API write path.
REVOKE EXECUTE ON FUNCTION public.crm_refresh_client_primary_assignment(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_refresh_client_primary_assignment(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid,p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id))))
  )
$$;
CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid,p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        (c.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_requests r
          WHERE r.company_id=p.company_id AND r.client_id=c.id AND
            ((r.assigned_to=p.id AND r.status<>'archived') OR
              (r.status IN ('active','paused') AND EXISTS(
                SELECT 1 FROM public.client_request_assignees a
                WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))))
  )
$$;
CREATE OR REPLACE FUNCTION crm_repair_private.can_access_whatsapp_conversation(p_company_id uuid,p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.whatsapp_conversations c ON c.company_id=p.company_id AND c.id=p_conversation_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role='owner' OR (
        -- An inactive route keeps its privacy rule. An unknown route fails closed.
        EXISTS(SELECT 1 FROM public.company_lead_routes r
          WHERE r.company_id=p.company_id AND r.route_key=c.route_key
            AND r.owner_only_inbox IS FALSE)
        AND (p.role='manager' OR (p.role='agent' AND
          (c.assigned_to=p.id OR crm_repair_private.can_access_client(p.company_id,c.client_id))))
      ))
  )
$$;
REVOKE ALL ON FUNCTION crm_repair_private.can_access_request(uuid,uuid),
  crm_repair_private.can_access_client(uuid,uuid),
  crm_repair_private.can_access_whatsapp_conversation(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.can_access_request(uuid,uuid),
  crm_repair_private.can_access_client(uuid,uuid),
  crm_repair_private.can_access_whatsapp_conversation(uuid,uuid) TO authenticated, service_role;

ALTER POLICY client_request_events_select_allowed ON public.client_request_events TO authenticated
USING (company_id=(SELECT public.my_company())
  AND crm_repair_private.can_access_request(company_id,request_id));
ALTER POLICY whatsapp_message_requests_select_allowed ON public.whatsapp_message_requests TO authenticated
USING (company_id=(SELECT public.my_company())
  AND crm_repair_private.can_access_request(company_id,request_id));

ALTER POLICY viewings_select_company ON public.viewings TO authenticated
USING (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager','viewer') OR
   ((SELECT public.my_role())='agent' AND crm_repair_private.can_access_client(company_id,client_id))));
ALTER POLICY viewings_insert_staff ON public.viewings TO authenticated
WITH CHECK (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))));
ALTER POLICY viewings_update_staff ON public.viewings TO authenticated
USING (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))))
WITH CHECK (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))));

ALTER POLICY appointments_select_allowed ON public.appointments TO authenticated
USING (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager','viewer') OR
   ((SELECT public.my_role())='agent' AND crm_repair_private.can_access_client(company_id,client_id))));
ALTER POLICY appointments_insert_allowed ON public.appointments TO authenticated
WITH CHECK (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))));
ALTER POLICY appointments_update_allowed ON public.appointments TO authenticated
USING (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))))
WITH CHECK (company_id=(SELECT public.my_company()) AND
  ((SELECT public.my_role()) IN ('owner','manager') OR
   ((SELECT public.my_role())='agent' AND agent_id=(SELECT auth.uid())
    AND crm_repair_private.can_access_client(company_id,client_id))));

ALTER POLICY deal_stage_history_select_company ON public.deal_stage_history TO authenticated
USING (company_id=(SELECT public.my_company()) AND EXISTS(
  SELECT 1 FROM public.deals d WHERE d.id=deal_stage_history.deal_id AND d.company_id=deal_stage_history.company_id));
-- The existing SECURITY DEFINER record_deal_stage_history trigger is the sole writer.
DROP POLICY deal_stage_history_insert_company ON public.deal_stage_history;
REVOKE INSERT, UPDATE, DELETE ON public.deal_stage_history FROM anon, authenticated;

ALTER POLICY whatsapp_conversations_select_by_role ON public.whatsapp_conversations TO authenticated
USING (crm_repair_private.can_access_whatsapp_conversation(company_id,id));
ALTER POLICY whatsapp_messages_select_by_role ON public.whatsapp_messages TO authenticated
USING (crm_repair_private.can_access_whatsapp_conversation(company_id,conversation_id));

-- Notification self-access must also stop for a disabled profile.
ALTER POLICY "Own notifications only" ON public.notifications TO authenticated
USING (user_id=(SELECT auth.uid()) AND (SELECT public.my_company()) IS NOT NULL);
ALTER POLICY "Update own notifications" ON public.notifications TO authenticated
USING (user_id=(SELECT auth.uid()) AND (SELECT public.my_company()) IS NOT NULL)
WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT public.my_company()) IS NOT NULL);
ALTER POLICY notifications_insert_own ON public.notifications TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT public.my_company()) IS NOT NULL);

-- Instagram policies/credentials/tables are untouched. Their existing my_company/my_role
-- calls inherit active-profile enforcement, while service-role webhook ingestion is unchanged.
COMMIT;
