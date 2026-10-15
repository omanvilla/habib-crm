-- Dashboard only: materialize permitted source rows once, retain every existing RLS policy.
-- Explicit Muscat/Barka predicates repeat the unchanged permission helper as initPlans
-- so disallowed branches are filtered before expensive per-row linked checks.
-- No business-row mutation, employee assignment/routing changes or investment backfill.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.dashboard_catalog_backup(
 object_identity text PRIMARY KEY,definition text NOT NULL,acl jsonb,owner_name text,installed_definition text,captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.dashboard_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.dashboard_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.dashboard_catalog_backup(object_identity,definition,acl,owner_name)
 SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid),to_jsonb(p.proacl),pg_get_userbyid(p.proowner)
 FROM pg_proc p WHERE p.oid='public.crm_client_contact_queue(integer)'::regprocedure
 ON CONFLICT(object_identity) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_client_contact_queue(p_limit integer DEFAULT 500)
 RETURNS TABLE(client_id uuid, client_name text, phone text, created_at timestamp with time zone, human_contact_at timestamp with time zone, oldest_pending_at timestamp with time zone, pending_requests integer, assigned_to uuid, lead_temperature text, active_request_id uuid, next_followup date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as materialized (
  select c.*
  from public.clients c
  where c.company_id=(select public.my_company())
    and (c.lead_route is distinct from 'muscat' or (select crm_repair_private.staff_can_access_branch(public.my_company(),'muscat')))
    and (c.lead_route is distinct from 'barka' or (select crm_repair_private.staff_can_access_branch(public.my_company(),'barka')))
    and coalesce(c.archived,false)=false
    and coalesce(c.followup_suppressed,false)=false
), raw_req as materialized (
  select r.* from public.client_requests r
  where r.company_id=(select public.my_company()) and r.status='active'
    and (coalesce(r.branch_key,r.route_key) is distinct from 'muscat' or (select crm_repair_private.staff_can_access_branch(public.my_company(),'muscat')))
    and (coalesce(r.branch_key,r.route_key) is distinct from 'barka' or (select crm_repair_private.staff_can_access_branch(public.my_company(),'barka')))
), req as materialized (
  select r.*,
         case when r.first_human_response_at is null
               and (b.human_contact_at is null or b.human_contact_at<r.created_at)
              then true else false end as unanswered
  from raw_req r
  join base b on b.id=r.client_id
), grouped as materialized (
  select b.id as client_id,
         count(*) filter(where r.unanswered)::int as pending_requests,
         min(r.created_at) filter(where r.unanswered) as oldest_pending_at,
         (array_agg(r.id order by r.created_at asc) filter(where r.unanswered))[1] as active_request_id,
         min(r.next_followup) filter(where r.status='active' and r.next_followup is not null) as next_followup,
         count(r.id)::int as active_requests
  from base b left join req r on r.client_id=b.id
  group by b.id
)
select b.id,b.name,b.phone,b.created_at,b.human_contact_at,
       coalesce(g.oldest_pending_at,b.created_at),
       case when g.pending_requests>0 then g.pending_requests
            when coalesce(g.active_requests,0)=0 and b.human_contact_at is null then 1
            else 0 end,
       b.assigned_to,b.lead_temperature,g.active_request_id,g.next_followup
from base b
join grouped g on g.client_id=b.id
where g.pending_requests>0
   or (coalesce(g.active_requests,0)=0 and b.human_contact_at is null)
order by coalesce(g.oldest_pending_at,b.created_at) asc
limit greatest(1,least(coalesce(p_limit,500),2000));
$function$
;

-- The exposed RPC below remains SECURITY INVOKER. This non-exposed classifier
-- can inspect the existing private graph only for the active same-company owner.
-- Staff never get a private-row oracle: ordinary scope still relies on table RLS.
CREATE FUNCTION crm_repair_private.dashboard_row_in_scope(p_company uuid,p_row jsonb,p_scope text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text;
BEGIN
 SELECT p.role INTO role_name FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.company_id=p_company AND p.is_active IS TRUE;
 IF role_name IS NULL OR p_scope NOT IN ('branches','investment') THEN RETURN false;END IF;
 IF role_name<>'owner' THEN RETURN p_scope='branches';END IF;
 RETURN crm_repair_private.investment_link_is_private(p_company,p_row)=(p_scope='investment');
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.dashboard_row_in_scope(uuid,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION crm_repair_private.dashboard_row_in_scope(uuid,jsonb,text) TO authenticated;

CREATE FUNCTION public.crm_dashboard_work(p_scope text DEFAULT 'branches',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE company uuid:=public.my_company(); role_name text:=public.my_role();
 can_muscat boolean:=crm_repair_private.staff_can_access_branch(company,'muscat');
 can_barka boolean:=crm_repair_private.staff_can_access_branch(company,'barka');
 today date:=(now() AT TIME ZONE 'Asia/Muscat')::date; result jsonb; page_size integer:=greatest(1,least(coalesce(p_limit,20),200)); page_offset integer:=greatest(0,coalesce(p_offset,0));
BEGIN
 IF auth.uid() IS NULL OR company IS NULL OR role_name IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
 IF p_scope IS NULL OR p_scope NOT IN('branches','investment') THEN RAISE EXCEPTION 'invalid_dashboard_scope' USING ERRCODE='22023';END IF;
 IF p_scope='investment' AND role_name<>'owner' THEN RAISE EXCEPTION 'investment_owner_only' USING ERRCODE='42501';END IF;
 WITH
 visible_clients AS MATERIALIZED (
   SELECT c.id,c.name,c.phone,c.lead_route,c.assigned_to,c.human_contact_at,c.created_at,c.followup_suppressed
   FROM public.clients c WHERE c.company_id=company AND NOT coalesce(c.archived,false)
     AND (c.lead_route IS DISTINCT FROM 'muscat' OR can_muscat)
     AND (c.lead_route IS DISTINCT FROM 'barka' OR can_barka)
 ),
 source_requests AS MATERIALIZED (
   SELECT r.id,r.client_id,r.status,r.request_type,r.preferred_area,r.next_action,r.qualified_at,r.lead_temperature,
     r.pipeline_stage,r.created_at,r.next_followup,r.first_human_response_at,r.last_mutual_contact_at
   FROM public.client_requests r WHERE r.company_id=company AND r.status='active'
     AND (coalesce(r.branch_key,r.route_key) IS DISTINCT FROM 'muscat' OR can_muscat)
     AND (coalesce(r.branch_key,r.route_key) IS DISTINCT FROM 'barka' OR can_barka)
     AND crm_repair_private.dashboard_row_in_scope(company,to_jsonb(r),p_scope)
 ),
 requests AS MATERIALIZED (
   SELECT r.* FROM source_requests r JOIN visible_clients c ON c.id=r.client_id
   WHERE NOT coalesce(c.followup_suppressed,false)
 ),
 scope_clients AS MATERIALIZED (
   SELECT c.* FROM visible_clients c WHERE NOT coalesce(c.followup_suppressed,false)
     AND ((p_scope='investment' AND (c.lead_route='investment' OR EXISTS(SELECT 1 FROM requests r WHERE r.client_id=c.id)))
       OR (p_scope='branches' AND c.lead_route IS DISTINCT FROM 'investment'))
 ),
 unanswered AS MATERIALIZED (
   SELECT r.* FROM requests r JOIN scope_clients c ON c.id=r.client_id
   WHERE r.first_human_response_at IS NULL
     AND (p_scope='investment' OR c.human_contact_at IS NULL OR c.human_contact_at<r.created_at)
 ),
 pending AS MATERIALIZED (
   SELECT c.id AS client_id,c.name AS client_name,c.phone,c.created_at,c.human_contact_at,c.assigned_to,
     min(r.created_at) AS oldest_pending_at,count(r.id)::int AS pending_requests,
     (array_agg(r.id ORDER BY r.created_at,r.id) FILTER(WHERE r.id IS NOT NULL))[1] AS active_request_id
   FROM scope_clients c LEFT JOIN unanswered r ON r.client_id=c.id
   GROUP BY c.id,c.name,c.phone,c.created_at,c.human_contact_at,c.assigned_to
   HAVING count(r.id)>0 OR (c.human_contact_at IS NULL AND NOT EXISTS(SELECT 1 FROM requests a WHERE a.client_id=c.id))
 ),
 viewings AS MATERIALIZED (
   SELECT v.id,v.client_id,v.request_id,v.property_id,v.viewing_date,v.viewing_time,v.status
   FROM public.viewings v WHERE v.company_id=company AND NOT coalesce(v.archived,false)
     AND v.viewing_date>=today AND v.status IS DISTINCT FROM 'cancelled'
     AND crm_repair_private.dashboard_row_in_scope(company,to_jsonb(v),p_scope)
 ),
 deals AS MATERIALIZED (
   SELECT d.id,d.client_id,d.request_id,d.property_id,d.stage,d.updated_at
   FROM public.deals d WHERE d.company_id=company AND d.stage NOT IN('closed','commission_collected','lost')
     AND crm_repair_private.dashboard_row_in_scope(company,jsonb_build_object('client_id',d.client_id,'request_id',d.request_id,'property_id',d.property_id,'viewing_id',d.viewing_id),p_scope)
 ),
 tasks AS MATERIALIZED (
   SELECT t.id,t.user_id,t.client_id,t.request_id,t.deal_id,t.viewing_id,t.title,t.due_date,t.priority,t.done
   FROM public.tasks t WHERE t.company_id=company AND NOT coalesce(t.done,false)
     AND crm_repair_private.dashboard_row_in_scope(company,to_jsonb(t),p_scope)
 ),
 followup_rows AS MATERIALIZED (
   SELECT * FROM requests WHERE next_followup<=today
   ORDER BY next_followup,created_at,id LIMIT page_size OFFSET page_offset
 ),
 hot_rows AS MATERIALIZED (
   SELECT * FROM requests WHERE lead_temperature='hot' AND (created_at>=now()-interval '30 days' OR last_mutual_contact_at>=now()-interval '30 days' OR next_followup IS NOT NULL)
   ORDER BY next_followup NULLS LAST,created_at,id LIMIT page_size OFFSET page_offset
 ),
 request_rows AS MATERIALIZED (
   SELECT * FROM requests WHERE next_followup<=today OR lead_temperature='hot' OR (next_followup IS NULL AND (qualified_at IS NOT NULL OR pipeline_stage='qualified'))
   ORDER BY next_followup NULLS LAST,created_at,id LIMIT page_size OFFSET page_offset
 ),
 visit_rows AS MATERIALIZED (
   SELECT v.*,jsonb_build_object('name',c.name) AS client,jsonb_build_object('title',p.title) AS property
   FROM (SELECT * FROM viewings WHERE viewing_date=today OR status IN('scheduled','confirmed','postponed') ORDER BY viewing_date,viewing_time NULLS LAST,id LIMIT page_size OFFSET page_offset) v
   LEFT JOIN visible_clients c ON c.id=v.client_id LEFT JOIN public.properties p ON p.id=v.property_id AND p.company_id=company
 ),
 deal_rows AS MATERIALIZED (
   SELECT d.*,jsonb_build_object('name',c.name) AS client,jsonb_build_object('title',p.title) AS property
   FROM (SELECT * FROM deals ORDER BY updated_at DESC NULLS LAST,id LIMIT page_size OFFSET page_offset) d
   LEFT JOIN visible_clients c ON c.id=d.client_id LEFT JOIN public.properties p ON p.id=d.property_id AND p.company_id=company
 ),
 task_rows AS MATERIALIZED (
   SELECT * FROM tasks ORDER BY (priority='high' OR due_date<=today) DESC NULLS LAST,due_date NULLS LAST,id LIMIT page_size OFFSET page_offset
 ),
 contact_rows AS MATERIALIZED (SELECT * FROM pending ORDER BY coalesce(oldest_pending_at,created_at),client_id LIMIT page_size OFFSET page_offset),
 hot AS MATERIALIZED (
   SELECT DISTINCT client_id FROM requests WHERE lead_temperature='hot'
     AND (created_at>=now()-interval '30 days' OR last_mutual_contact_at>=now()-interval '30 days' OR next_followup IS NOT NULL)
 ),
 due AS MATERIALIZED (SELECT DISTINCT client_id FROM requests WHERE next_followup<=today)
 SELECT jsonb_build_object(
   'scope',p_scope,'as_of',today,'generated_at',now(),'limit',page_size,'offset',page_offset,
   'totals',jsonb_build_object('requests',(SELECT count(*) FROM requests WHERE next_followup<=today OR lead_temperature='hot' OR (next_followup IS NULL AND (qualified_at IS NOT NULL OR pipeline_stage='qualified'))),
     'followups',(SELECT count(*) FROM requests WHERE next_followup<=today),'hotRequests',(SELECT count(*) FROM requests WHERE lead_temperature='hot' AND (created_at>=now()-interval '30 days' OR last_mutual_contact_at>=now()-interval '30 days' OR next_followup IS NOT NULL)),
     'visits',(SELECT count(*) FROM viewings WHERE viewing_date=today OR status IN('scheduled','confirmed','postponed')),'deals',(SELECT count(*) FROM deals),'tasks',(SELECT count(*) FROM tasks),'contactQueue',(SELECT count(*) FROM pending)),
   'counts',jsonb_build_object('uncontacted',(SELECT count(*) FROM pending),'followups_due',(SELECT count(*) FROM due),
     'hot_requests',(SELECT count(*) FROM hot),'viewings_today',(SELECT count(*) FROM viewings WHERE viewing_date=today),
     'open_deals',(SELECT count(*) FROM deals),'urgent_tasks',(SELECT count(*) FROM tasks WHERE priority='high' OR due_date<=today),'open_tasks',(SELECT count(*) FROM tasks)),
   'followups',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM followup_rows r),'[]'::jsonb),
   'hotRequests',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM hot_rows r),'[]'::jsonb),
   'requests',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM request_rows r),'[]'::jsonb),
   'clients',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone)) FROM visible_clients c
     WHERE c.id IN(SELECT client_id FROM request_rows UNION SELECT client_id FROM followup_rows UNION SELECT client_id FROM hot_rows UNION SELECT client_id FROM contact_rows UNION SELECT client_id FROM task_rows)),'[]'::jsonb),
   'visits',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM visit_rows v),'[]'::jsonb),
   'deals',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM deal_rows d),'[]'::jsonb),
   'tasks',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM task_rows t),'[]'::jsonb),
   'contactQueue',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM contact_rows q),'[]'::jsonb),
   'clientFilters',jsonb_build_object('uncontacted',coalesce((SELECT jsonb_agg(client_id ORDER BY client_id) FROM pending),'[]'::jsonb),
     'due',coalesce((SELECT jsonb_agg(client_id ORDER BY client_id) FROM due),'[]'::jsonb),
     'hotfocus',coalesce((SELECT jsonb_agg(client_id ORDER BY client_id) FROM hot),'[]'::jsonb))
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_dashboard_work(text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.crm_dashboard_work(text,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.crm_dashboard_work(text,integer,integer) IS 'Exact RLS-filtered operational dashboard counts with bounded action lists, Oman calendar day and isolated owner investment workspace.';
UPDATE crm_repair_private.dashboard_catalog_backup SET installed_definition=pg_get_functiondef('public.crm_client_contact_queue(integer)'::regprocedure) WHERE object_identity='crm_client_contact_queue(integer)';
