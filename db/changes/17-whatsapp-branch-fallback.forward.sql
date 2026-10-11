-- Unknown property geography must not transfer an inbound Barka contact to Muscat.
-- No customer rows are changed by this catalog migration; repair is separately scoped/audited.
CREATE TABLE IF NOT EXISTS crm_repair_private.whatsapp_branch_catalog_backup(
  object_identity text PRIMARY KEY,definition text NOT NULL,acl jsonb,owner_name text,captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.whatsapp_branch_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.whatsapp_branch_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.whatsapp_branch_catalog_backup(object_identity,definition,acl,owner_name)
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid),to_jsonb(p.proacl),pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN('crm_set_request_geography','crm_sync_request_assignees',
  'crm_refresh_client_primary_assignment','normalize_request_branch_when_location_missing')
ON CONFLICT(object_identity) DO NOTHING;
CREATE TABLE IF NOT EXISTS crm_repair_private.whatsapp_branch_repair_audit(
  company_id uuid NOT NULL,client_id uuid NOT NULL,change_key text NOT NULL,before_data jsonb NOT NULL,
  after_data jsonb,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(change_key,company_id,client_id)
);
ALTER TABLE crm_repair_private.whatsapp_branch_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.whatsapp_branch_repair_audit FROM PUBLIC,anon,authenticated,service_role;

-- Routing evidence is private: no new browser-callable RPC or RLS exception.
CREATE OR REPLACE FUNCTION crm_repair_private.whatsapp_request_physical_branch(
  p_company_id uuid,p_client_id uuid,p_origin_message_id uuid,p_inbound_number text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_route text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.company_id=p_company_id) THEN RETURN NULL;END IF;
  IF p_origin_message_id IS NOT NULL THEN
    SELECT w.route_key INTO v_route
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations w ON w.id=m.conversation_id
      AND w.company_id=m.company_id AND w.client_id=m.client_id
    WHERE m.id=p_origin_message_id AND m.company_id=p_company_id AND m.client_id=p_client_id
      AND m.direction='inbound' AND w.route_key IN('muscat','barka','investment')
      AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=p_company_id
        AND lr.route_key=w.route_key AND lr.is_active IS TRUE);
    RETURN v_route;
  END IF;
  IF nullif(btrim(p_inbound_number),'') IS NULL THEN RETURN NULL;END IF;
  SELECT min(lr.route_key) INTO v_route FROM public.company_lead_routes lr
  WHERE lr.company_id=p_company_id AND lr.is_active IS TRUE AND lr.route_key IN('muscat','barka','investment')
    AND public.normalize_crm_phone(lr.whatsapp_number)=public.normalize_crm_phone(p_inbound_number)
  HAVING count(DISTINCT lr.route_key)=1;
  RETURN v_route;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.whatsapp_request_physical_branch(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_repair_private.whatsapp_request_physical_branch(uuid,uuid,uuid,text) TO service_role;

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

  perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
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
  select array_agg(distinct a.user_id), array_agg(distinct a.branch_key)
    into users,branches
  from public.client_request_assignees a
  join public.client_requests r on r.id=a.request_id
  where a.company_id=p_company_id and r.client_id=p_client_id and r.status in ('active','paused');

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

CREATE OR REPLACE FUNCTION public.normalize_request_branch_when_location_missing()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $function$
DECLARE physical_muscat boolean:=false;
BEGIN
  IF new.route_key IS DISTINCT FROM 'investment'
    AND 'location'=ANY(coalesce(new.missing_required_fields,'{}'::text[]))
    AND new.branch_key='muscat' THEN
    -- Keep this trigger invoker-only. The evidence lookup obeys the caller's RLS.
    -- The privileged ingestion path can see the same verified evidence as the private helper.
    IF new.manual_assigned_to IS NULL AND new.subject_property_id IS NULL THEN
      IF new.origin_whatsapp_message_id IS NOT NULL THEN
        SELECT EXISTS(
          SELECT 1 FROM public.whatsapp_messages m
          JOIN public.whatsapp_conversations w ON w.id=m.conversation_id
            AND w.company_id=m.company_id AND w.client_id=m.client_id
          WHERE m.id=new.origin_whatsapp_message_id AND m.company_id=new.company_id AND m.client_id=new.client_id
            AND m.direction='inbound' AND w.route_key='muscat'
            AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=new.company_id
              AND lr.route_key=w.route_key AND lr.is_active IS TRUE)
        ) INTO physical_muscat;
      ELSIF nullif(btrim(new.inbound_number),'') IS NOT NULL THEN
        SELECT coalesce(min(lr.route_key)='muscat' AND count(DISTINCT lr.route_key)=1,false)
          INTO physical_muscat
        FROM public.company_lead_routes lr
        WHERE lr.company_id=new.company_id AND lr.is_active IS TRUE AND lr.route_key IN('muscat','barka','investment')
          AND public.normalize_crm_phone(lr.whatsapp_number)=public.normalize_crm_phone(new.inbound_number);
      END IF;
    END IF;
    IF NOT physical_muscat THEN new.branch_key:='general';END IF;
  END IF;
  RETURN new;
END;
$function$;

