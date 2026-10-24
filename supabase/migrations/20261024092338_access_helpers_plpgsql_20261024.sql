-- SQL40: cache the plans of the four per-row access helpers.
--
-- can_access_client, can_access_request, can_access_whatsapp_conversation and
-- staff_can_access_branch were LANGUAGE sql SECURITY DEFINER. Such functions are
-- never inlined, and on PostgreSQL 17 a non-inlined SQL function re-plans its
-- query on every call: ~0.45 ms per can_access_client call (2.9 s over an
-- agent's 6,429 activity rows) and ~0.3 ms per can_access_whatsapp_conversation
-- call (3.2 s over 10,473 messages). PL/pgSQL caches the plan for the session.
--
-- Each body below is the applied query verbatim, wrapped in RETURN; signatures,
-- STABLE, SECURITY DEFINER, search_path and grants are unchanged.

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
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
  );
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND crm_repair_private.investment_row_allowed(p_company_id,to_jsonb(r))
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(r.branch_key,r.route_key,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,coalesce(r.branch_key,r.route_key))) AND (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))
  );
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_whatsapp_conversation(p_company_id uuid, p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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

CREATE OR REPLACE FUNCTION crm_repair_private.staff_can_access_branch(p_company uuid, p_branch text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and (p_branch IS DISTINCT FROM 'investment' OR p.role='owner')
     and (p.role in ('owner','manager','viewer')
       or (p.role='agent' and exists(
         select 1 from public.company_lead_routes r
         where r.company_id=p_company and r.assigned_to=p.id
           and r.route_key=p_branch and r.owner_only_inbox is false)))
  );
END
$function$;
