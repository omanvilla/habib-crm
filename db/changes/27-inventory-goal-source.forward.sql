-- SQL27: current available inventory and independent weekly additions.
-- The ordinary property save does not populate availability_checked_at. Do not
-- fabricate that evidence or change any business row to repair a reporting gate.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit27_catalog_backup(
 identity text PRIMARY KEY,definition text NOT NULL,applied_definition text
);
ALTER TABLE crm_repair_private.audit27_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit27_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO crm_repair_private.audit27_catalog_backup(identity,definition)
SELECT 'public.crm_employee_target_snapshot()',pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid='public.crm_employee_target_snapshot()'::regprocedure
ON CONFLICT DO NOTHING;
-- Reapplication may replace this release or its restored predecessor, but must
-- not silently overwrite a subsequent independently changed function.
DO $$ DECLARE b record;BEGIN
 SELECT * INTO STRICT b FROM crm_repair_private.audit27_catalog_backup
 WHERE identity='public.crm_employee_target_snapshot()';
 IF b.applied_definition IS NOT NULL
  AND pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.definition
  AND pg_get_functiondef(to_regprocedure(b.identity)) IS DISTINCT FROM b.applied_definition THEN
  RAISE EXCEPTION 'SQL27 apply refused: function changed since release: %',b.identity;
 END IF;
END $$;

-- Standing inventory uses the current available/non-archived state across all
-- dates and prices. Weekly additions require a positive price and their actual
-- Oman-local creation week; a later sale retains credit, an archive removes it.
-- Explicit private-link exclusion gives owner and employee the same branch count.
CREATE OR REPLACE FUNCTION public.crm_employee_target_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();today date:=(now() AT TIME ZONE 'Asia/Muscat')::date;wk date;mo date;result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 wk:=today-extract(dow FROM today)::int;mo:=date_trunc('month',today)::date;
 WITH employees AS (
  SELECT e.id,e.full_name,lr.route_key branch FROM public.company_lead_routes lr JOIN public.profiles e ON e.id=lr.assigned_to AND e.company_id=lr.company_id
  WHERE lr.company_id=c AND lr.route_key IN ('muscat','barka') AND lr.is_active AND NOT lr.owner_only_inbox AND e.is_active AND e.role='agent' AND (r<>'agent' OR e.id=u)
 ), counts AS (
  SELECT e.*,t.employee_id target_id,
  CASE WHEN t.employee_id IS NULL THEN 10 ELSE t.inventory_target END inventory_goal,
  CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions_goal,
  CASE WHEN t.employee_id IS NULL THEN 10 ELSE t.daily_followups_target END followups_goal,
  CASE WHEN t.employee_id IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings_goal,
  CASE WHEN t.employee_id IS NULL THEN 2 ELSE t.reservations_target END bookings_goal,
  CASE WHEN t.employee_id IS NULL THEN 4000 ELSE t.booking_commission_target END commission_goal,
  jsonb_array_length(pr.inventory_property_ids) inventory,jsonb_array_length(pr.new_property_ids) additions,
  pr.inventory_property_ids,pr.new_property_ids,
  (SELECT count(DISTINCT a.client_id) FROM public.activities a JOIN public.clients cl ON cl.id=a.client_id AND cl.company_id=a.company_id
   WHERE a.company_id=c AND crm_repair_private.performance_employee(c,cl.lead_route,coalesce(a.occurred_at,a.created_at),a.user_id)=e.id
   AND cl.lead_route=e.branch AND a.actor_type='human' AND nullif(btrim(a.outcome),'') IS NOT NULL AND a.type IN ('call','followup','meeting','whatsapp','contact','email') AND (coalesce(a.occurred_at,a.created_at) AT TIME ZONE 'Asia/Muscat')::date=today
   AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(a))) followups,
  (SELECT count(DISTINCT v.id) FROM public.viewings v JOIN public.properties p ON p.id=v.property_id AND p.company_id=v.company_id
   WHERE v.company_id=c AND p.branch_key=e.branch AND crm_repair_private.performance_employee(c,p.branch_key,v.viewing_date::timestamp AT TIME ZONE 'Asia/Muscat',v.agent_id)=e.id AND v.status='done' AND NOT coalesce(v.archived,false) AND v.viewing_date BETWEEN wk AND today AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(v))) viewings,
  coalesce(b.reservations,0) bookings,coalesce(b.active_reservations,0) live_bookings,coalesce(b.cancelled_reservations,0) cancelled_bookings,
  coalesce(b.expected_commission,0) expected_commission,coalesce(b.commission_collected,0) collected_commission
  FROM employees e LEFT JOIN public.employee_monthly_targets t ON t.company_id=c AND t.employee_id=e.id AND t.month_start=mo
  LEFT JOIN LATERAL (
   SELECT coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.status='available'),'[]'::jsonb) inventory_property_ids,
    coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.price>0 AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date BETWEEN wk AND today),'[]'::jsonb) new_property_ids
   FROM public.properties p
   WHERE p.company_id=c AND p.branch_key=e.branch AND NOT coalesce(p.archived,false)
    AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
    AND NOT crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p))
  ) pr ON true
  LEFT JOIN crm_repair_private.deal_period_metrics(mo,today+1) b ON b.employee_id=e.id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'branch',branch,'inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,
  'inventory_property_ids',inventory_property_ids,'new_property_ids',new_property_ids,
  'bookings',bookings,'live_bookings',live_bookings,'cancelled_bookings',cancelled_bookings,
  'expected_commission',CASE WHEN r='owner' OR id=u THEN expected_commission END,'collected_commission',CASE WHEN r='owner' OR id=u THEN collected_commission END,
  'goals',jsonb_build_object('inventory',inventory_goal,'new_properties',additions_goal,'followups',followups_goal,'viewings',viewings_goal,'bookings',bookings_goal,'expected_commission',commission_goal),
  'sales_goal_met',((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))) ORDER BY branch),'[]'::jsonb) INTO result FROM counts;
 RETURN jsonb_build_object('today',today,'week_start',wk,'week_end',wk+6,'month_start',mo,'month_end',(mo+interval '1 month - 1 day')::date,'employees',result);
END $$;
REVOKE ALL ON FUNCTION public.crm_employee_target_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_employee_target_snapshot() TO authenticated;

UPDATE crm_repair_private.audit27_catalog_backup b
SET applied_definition=pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.oid=to_regprocedure(b.identity);
NOTIFY pgrst,'reload schema';
