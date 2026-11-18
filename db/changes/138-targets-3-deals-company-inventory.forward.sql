-- SQL138 (18 Nov 2026, Ahmed's decision review [3] and [62], docs/مراجعة-القرارات-20261118.md, approved «نعم موافق»).
--  [3]  the monthly sales target is 3 deals (paid bookings) AND OMR 5,400 expected office commission, per branch/month
--       by default (was 2 bookings OR OMR 4,000). «Met» now needs every target that is switched on (a saved 0 switches
--       one off). Saved branch/month overrides still win (the October 2026 rows stay exactly as saved).
--  [62] inventory: one company number, 25 good available non-archived properties (no split between branches). The
--       snapshot gets `company_inventory` {count, goal, property_ids}; the per-branch inventory goal is gone (null), the
--       branch count stays for information. The owner's target form no longer asks for a branch inventory number
--       (crm_save_branch_monthly_targets accepts 5 keys; a 6th inventory_target is still accepted and kept).
-- Money stays owner-only exactly as before (SQL118/119): expected/collected commission are null for staff.
-- No historical row is changed: only column defaults and function defaults.
-- Rollback: 138-targets-3-deals-company-inventory.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE crm_repair_private.branch_monthly_targets ALTER COLUMN reservations_target SET DEFAULT 3,
  ALTER COLUMN booking_commission_target SET DEFAULT 5400, ALTER COLUMN inventory_target SET DEFAULT 0;
ALTER TABLE public.employee_monthly_targets ALTER COLUMN reservations_target SET DEFAULT 3,
  ALTER COLUMN booking_commission_target SET DEFAULT 5400;

-- Ahmed 16/18 Nov 2026: 25 good available properties for the company by 12 Feb 2027, no split between branches
CREATE OR REPLACE FUNCTION crm_repair_private.company_inventory_goal() RETURNS integer
 LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$ SELECT 25 $$;
REVOKE ALL ON FUNCTION crm_repair_private.company_inventory_goal() FROM public, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.company_inventory_goal() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_branch_monthly_targets(p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN RAISE EXCEPTION 'invalid_target_month' USING ERRCODE='22023';END IF;
 WITH branches AS (
  SELECT x.branch,x.label FROM (VALUES ('muscat','مسقط'),('barka','بركاء')) x(branch,label)
  WHERE r<>'agent' OR crm_repair_private.staff_is_branch_member(c,x.branch)
 ), goals AS (
  SELECT x.branch,x.label,t.updated_at,t.branch_key IS NOT NULL configured,
   NULL::int inventory,
   CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions,
   CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.daily_followups_target END followups,
   CASE WHEN t.branch_key IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings,
   CASE WHEN t.branch_key IS NULL THEN 3 ELSE t.reservations_target END bookings,
   CASE WHEN t.branch_key IS NULL THEN 5400 ELSE t.booking_commission_target END commission
  FROM branches x LEFT JOIN crm_repair_private.branch_monthly_targets t
   ON t.company_id=c AND t.branch_key=x.branch AND t.month_start=p_month
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',branch,'branch',branch,'branch_key',branch,'name',label,
  'month_start',p_month,'updated_at',updated_at,'configured',configured,
  'goals',jsonb_build_object('inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,'bookings',bookings,'expected_commission',commission),
  'targets',jsonb_build_object('inventory_target',inventory,'weekly_new_properties_target',additions,'daily_followups_target',followups,'weekly_viewings_target',viewings,'reservations_target',bookings,'booking_commission_target',commission)
 ) ORDER BY branch),'[]'::jsonb) INTO result FROM goals;
 RETURN jsonb_build_object('scope','branch','month_start',p_month,'branches',result,'employees',result,
  'company_inventory_goal',crm_repair_private.company_inventory_goal());
END $function$;

CREATE OR REPLACE FUNCTION public.crm_branch_target_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();today date:=(now() AT TIME ZONE 'Asia/Muscat')::date;wk date;mo date;result jsonb;inv jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 wk:=today-extract(dow FROM today)::int;mo:=date_trunc('month',today)::date;
 WITH employees AS (
  SELECT x.branch id,x.label full_name,x.branch
  FROM (VALUES ('muscat','مسقط'),('barka','بركاء')) x(branch,label)
  WHERE r<>'agent' OR crm_repair_private.staff_is_branch_member(c,x.branch)
 ), counts AS (
  SELECT e.*,t.branch_key target_id,t.updated_at,
  NULL::int inventory_goal,
  CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions_goal,
  CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.daily_followups_target END followups_goal,
  CASE WHEN t.branch_key IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings_goal,
  CASE WHEN t.branch_key IS NULL THEN 3 ELSE t.reservations_target END bookings_goal,
  CASE WHEN t.branch_key IS NULL THEN 5400 ELSE t.booking_commission_target END commission_goal,
  jsonb_array_length(pr.inventory_property_ids) inventory,jsonb_array_length(pr.new_property_ids) additions,
  pr.inventory_property_ids,pr.new_property_ids,
  (SELECT count(DISTINCT a.client_id) FROM public.activities a JOIN public.clients cl ON cl.id=a.client_id AND cl.company_id=a.company_id
   WHERE a.company_id=c AND (cl.lead_route)=e.id
   AND cl.lead_route=e.branch AND a.actor_type='human' AND nullif(btrim(a.outcome),'') IS NOT NULL AND a.type IN ('call','followup','meeting','whatsapp','contact','email') AND (coalesce(a.occurred_at,a.created_at) AT TIME ZONE 'Asia/Muscat')::date=today
   AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(a))) followups,
  (SELECT count(DISTINCT v.id) FROM public.viewings v JOIN public.properties p ON p.id=v.property_id AND p.company_id=v.company_id
   WHERE v.company_id=c AND p.branch_key=e.branch AND (p.branch_key)=e.id AND v.status='done' AND NOT coalesce(v.archived,false) AND v.viewing_date BETWEEN wk AND today AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(v))) viewings,
  coalesce(b.reservations,0) bookings,coalesce(b.active_reservations,0) live_bookings,coalesce(b.cancelled_reservations,0) cancelled_bookings,
  coalesce(b.expected_commission,0) expected_commission,coalesce(b.commission_collected,0) collected_commission
  FROM employees e LEFT JOIN crm_repair_private.branch_monthly_targets t ON t.company_id=c AND t.branch_key=e.id AND t.month_start=mo
  LEFT JOIN LATERAL (
   SELECT coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.status='available'),'[]'::jsonb) inventory_property_ids,
    coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.price>0 AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date BETWEEN wk AND today),'[]'::jsonb) new_property_ids
   FROM public.properties p
   WHERE p.company_id=c AND p.branch_key=e.branch AND NOT coalesce(p.archived,false)
    AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
    AND NOT crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p))
  ) pr ON true
  LEFT JOIN crm_repair_private.branch_period_metrics(mo,today+1) b ON b.branch_key=e.id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_id',id,'name',full_name,'branch',branch,'branch_key',branch,'updated_at',updated_at,'configured',target_id IS NOT NULL,'inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,
  'inventory_property_ids',inventory_property_ids,'new_property_ids',new_property_ids,
  'bookings',bookings,'live_bookings',live_bookings,'cancelled_bookings',cancelled_bookings,
  'expected_commission',CASE WHEN r='owner' THEN expected_commission END,'collected_commission',CASE WHEN r='owner' THEN collected_commission END,
  'goals',jsonb_build_object('inventory',inventory_goal,'new_properties',additions_goal,'followups',followups_goal,'viewings',viewings_goal,'bookings',bookings_goal,'expected_commission',commission_goal),
  'sales_goal_met',((bookings_goal>0 OR commission_goal>0) AND (bookings_goal<=0 OR bookings>=bookings_goal) AND (commission_goal<=0 OR expected_commission>=commission_goal))) ORDER BY branch),'[]'::jsonb) INTO result FROM counts;
 -- [62] one company inventory number: every available, non-archived, non-private property of the company, any branch
 SELECT jsonb_build_object('count',count(DISTINCT p.id),'goal',crm_repair_private.company_inventory_goal(),
   'property_ids',coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id),'[]'::jsonb))
   INTO inv FROM public.properties p
  WHERE p.company_id=c AND p.status='available' AND NOT coalesce(p.archived,false)
   AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
   AND NOT crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p));
 RETURN jsonb_build_object('scope','branch','today',today,'week_start',wk,'week_end',wk+6,'month_start',mo,'month_end',(mo+interval '1 month - 1 day')::date,'branches',result,'employees',result,'company_inventory',inv);
END $function$;

CREATE OR REPLACE FUNCTION public.crm_save_branch_monthly_targets(p_branch text, p_month date, p_targets jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid:=public.my_company();u uuid:=auth.uid();before_row crm_repair_private.branch_monthly_targets;
 after_row crm_repair_private.branch_monthly_targets;before_values jsonb;result jsonb;k text;n numeric;unchanged boolean:=false;targets jsonb;
 keys text[]:=ARRAY['inventory_target','weekly_new_properties_target','daily_followups_target','weekly_viewings_target','reservations_target','booking_commission_target'];
BEGIN
 IF c IS NULL OR u IS NULL OR public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE='42501';END IF;
 IF p_branch IS NULL OR p_branch NOT IN ('muscat','barka') OR p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN
  RAISE EXCEPTION 'invalid_branch_target_period' USING ERRCODE='22023';END IF;
 -- [62] SQL138: the branch inventory number left the form (the company has one number, 25); it may be absent
 IF jsonb_typeof(p_targets) IS DISTINCT FROM 'object' OR NOT p_targets ?& keys[2:6]
  OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_targets) x WHERE x <> ALL (keys)) THEN
  RAISE EXCEPTION 'invalid_branch_targets' USING ERRCODE='22023';END IF;
 -- Lock the branch-period even for a first save, then check the observed version.
 -- Repeating the same values is a no-op and cannot create duplicate history.
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':'||p_branch||':'||p_month::text,31));
 SELECT * INTO before_row FROM crm_repair_private.branch_monthly_targets
 WHERE company_id=c AND branch_key=p_branch AND month_start=p_month FOR UPDATE;
 -- an absent inventory_target keeps what is saved (0 for a new row: no per-branch inventory target)
 targets:=jsonb_build_object('inventory_target',coalesce(p_targets->'inventory_target',to_jsonb(coalesce(before_row.inventory_target,0))))||(p_targets-'inventory_target');
 FOREACH k IN ARRAY keys LOOP
  IF jsonb_typeof(targets->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_branch_target_value' USING ERRCODE='22023';END IF;
  n:=(targets->>k)::numeric;
  IF n<0 OR n IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   OR (k<>'booking_commission_target' AND (n<>trunc(n) OR n>1000))
   OR (k='booking_commission_target' AND (n>=100000000000 OR n<>round(n,3))) THEN
   RAISE EXCEPTION 'invalid_branch_target_value' USING ERRCODE='22023';END IF;
 END LOOP;
 IF before_row.company_id IS NOT NULL THEN
  before_values:=to_jsonb(before_row)-'company_id'-'branch_key'-'month_start'-'updated_at'-'updated_by';
  unchanged:=before_values=targets;
  IF NOT unchanged AND before_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'branch_targets_changed_reload' USING ERRCODE='40001';END IF;
 ELSIF p_expected_updated_at IS NOT NULL THEN
  RAISE EXCEPTION 'branch_targets_changed_reload' USING ERRCODE='40001';
 END IF;
 IF NOT unchanged THEN
  INSERT INTO crm_repair_private.branch_monthly_targets(company_id,branch_key,month_start,inventory_target,
   weekly_new_properties_target,daily_followups_target,weekly_viewings_target,reservations_target,booking_commission_target,updated_by,updated_at)
  VALUES(c,p_branch,p_month,(targets->>'inventory_target')::numeric::int,(targets->>'weekly_new_properties_target')::numeric::int,
   (targets->>'daily_followups_target')::numeric::int,(targets->>'weekly_viewings_target')::numeric::int,(targets->>'reservations_target')::numeric::int,
   (targets->>'booking_commission_target')::numeric,u,clock_timestamp())
  ON CONFLICT(company_id,branch_key,month_start) DO UPDATE SET inventory_target=excluded.inventory_target,
   weekly_new_properties_target=excluded.weekly_new_properties_target,daily_followups_target=excluded.daily_followups_target,
   weekly_viewings_target=excluded.weekly_viewings_target,reservations_target=excluded.reservations_target,
   booking_commission_target=excluded.booking_commission_target,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  RETURNING * INTO after_row;
  INSERT INTO crm_repair_private.branch_target_history(company_id,branch_key,month_start,before_data,after_data,source,actor_id)
  VALUES(c,p_branch,p_month,CASE WHEN before_row.company_id IS NOT NULL THEN to_jsonb(before_row) END,to_jsonb(after_row),'owner_branch_target_save',u);
 END IF;
 SELECT row INTO result FROM jsonb_array_elements(public.crm_branch_monthly_targets(p_month)->'branches') row WHERE row->>'branch_key'=p_branch;
 RETURN result||jsonb_build_object('scope','branch','month_start',p_month,'replayed',unchanged);
END $function$;

-- the period reports and the old per-employee functions: new defaults, no «10 per branch» inventory default,
-- and «met» = every switched-on target
DO $do$
DECLARE f text; k text; def text; old_met text; new_met text; b3 text; c5 text;
BEGIN
 FOREACH f IN ARRAY ARRAY['crm_branch_performance(date,date)','crm_employee_performance(date,date)','crm_employee_target_snapshot()'] LOOP
  def := pg_get_functiondef(('public.'||f)::regprocedure);
  k := CASE WHEN f LIKE 'crm_branch%' THEN 'branch_key' ELSE 'employee_id' END;
  IF f = 'crm_employee_target_snapshot()' THEN
   old_met := '((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))';
   new_met := '((bookings_goal>0 OR commission_goal>0) AND (bookings_goal<=0 OR bookings>=bookings_goal) AND (commission_goal<=0 OR expected_commission>=commission_goal))';
  ELSE
   b3 := format('(CASE WHEN t.%s IS NULL THEN 3 ELSE t.reservations_target END)', k);
   c5 := format('(CASE WHEN t.%s IS NULL THEN 5400 ELSE t.booking_commission_target END)', k);
   old_met := format('((CASE WHEN t.%1$s IS NULL THEN 2 ELSE t.reservations_target END)>0 AND coalesce(b.reservations,0)>=(CASE WHEN t.%1$s IS NULL THEN 2 ELSE t.reservations_target END) OR (CASE WHEN t.%1$s IS NULL THEN 4000 ELSE t.booking_commission_target END)>0 AND coalesce(b.expected_commission,0)>=(CASE WHEN t.%1$s IS NULL THEN 4000 ELSE t.booking_commission_target END))', k);
   new_met := format('((%1$s>0 OR %2$s>0) AND (%1$s<=0 OR coalesce(b.reservations,0)>=%1$s) AND (%2$s<=0 OR coalesce(b.expected_commission,0)>=%2$s))', b3, c5);
  END IF;
  IF position(old_met in def) = 0 THEN RAISE EXCEPTION '%: sales_goal_met expression not found', f; END IF;
  def := replace(def, old_met, new_met);
  def := replace(def, format('WHEN t.%s IS NULL THEN 2 ELSE t.reservations_target', k), format('WHEN t.%s IS NULL THEN 3 ELSE t.reservations_target', k));
  def := replace(def, format('WHEN t.%s IS NULL THEN 4000 ELSE t.booking_commission_target', k), format('WHEN t.%s IS NULL THEN 5400 ELSE t.booking_commission_target', k));
  def := replace(def, '''reservations_target'',2,''booking_commission_target'',4000', '''reservations_target'',3,''booking_commission_target'',5400');
  IF f = 'crm_branch_performance(date,date)' THEN
   def := replace(def, 'jsonb_build_object(''inventory_target'',10,', 'jsonb_build_object(''inventory_target'',NULL::int,');
  END IF;
  IF def ~ 'THEN 4000 ELSE|booking_commission_target'',4000' THEN RAISE EXCEPTION '%: an old 4000 default is left', f; END IF;
  EXECUTE def;
 END LOOP;
END $do$;
