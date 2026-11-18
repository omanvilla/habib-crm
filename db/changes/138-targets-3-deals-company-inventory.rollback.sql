-- Rollback of SQL138: back to 2 bookings OR OMR 4,000 and the per-branch inventory default 10. No data row is touched.
-- The three small functions get their exact pre-SQL138 definitions (as read live on 18 Nov 2026); the period reports
-- are reverse-replaced.
SET LOCAL lock_timeout = '10s';

ALTER TABLE crm_repair_private.branch_monthly_targets ALTER COLUMN reservations_target SET DEFAULT 2,
  ALTER COLUMN booking_commission_target SET DEFAULT 4000, ALTER COLUMN inventory_target SET DEFAULT 10;
ALTER TABLE public.employee_monthly_targets ALTER COLUMN reservations_target SET DEFAULT 2,
  ALTER COLUMN booking_commission_target SET DEFAULT 4000;

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
   CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.inventory_target END inventory,
   CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions,
   CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.daily_followups_target END followups,
   CASE WHEN t.branch_key IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings,
   CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target END bookings,
   CASE WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target END commission
  FROM branches x LEFT JOIN crm_repair_private.branch_monthly_targets t
   ON t.company_id=c AND t.branch_key=x.branch AND t.month_start=p_month
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',branch,'branch',branch,'branch_key',branch,'name',label,
  'month_start',p_month,'updated_at',updated_at,'configured',configured,
  'goals',jsonb_build_object('inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,'bookings',bookings,'expected_commission',commission),
  'targets',jsonb_build_object('inventory_target',inventory,'weekly_new_properties_target',additions,'daily_followups_target',followups,'weekly_viewings_target',viewings,'reservations_target',bookings,'booking_commission_target',commission)
 ) ORDER BY branch),'[]'::jsonb) INTO result FROM goals;
 RETURN jsonb_build_object('scope','branch','month_start',p_month,'branches',result,'employees',result);
END $function$;

-- crm_branch_target_snapshot: reverse the SQL138 changes in place
DO $do$
DECLARE def text := pg_get_functiondef('public.crm_branch_target_snapshot()'::regprocedure);
BEGIN
  def := replace(def, 'NULL::int inventory_goal,', 'CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.inventory_target END inventory_goal,');
  def := replace(def, 'WHEN t.branch_key IS NULL THEN 3 ELSE t.reservations_target', 'WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target');
  def := replace(def, 'WHEN t.branch_key IS NULL THEN 5400 ELSE t.booking_commission_target', 'WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target');
  def := replace(def, '((bookings_goal>0 OR commission_goal>0) AND (bookings_goal<=0 OR bookings>=bookings_goal) AND (commission_goal<=0 OR expected_commission>=commission_goal))',
                      '((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))');
  def := replace(def, ',''company_inventory'',inv);', ');');
  EXECUTE def;
END $do$;

-- crm_save_branch_monthly_targets: SQL138 still accepts the old 6-key payload, so it can stay; restore the strict
-- 6-key version only if wanted by re-running the definition from db/changes/31-branch-operations.forward.sql.

DO $do$
DECLARE f text; k text; def text; b3 text; c5 text;
BEGIN
 FOREACH f IN ARRAY ARRAY['crm_branch_performance(date,date)','crm_employee_performance(date,date)','crm_employee_target_snapshot()'] LOOP
  def := pg_get_functiondef(('public.'||f)::regprocedure);
  k := CASE WHEN f LIKE 'crm_branch%' THEN 'branch_key' ELSE 'employee_id' END;
  IF f = 'crm_employee_target_snapshot()' THEN
   def := replace(def, '((bookings_goal>0 OR commission_goal>0) AND (bookings_goal<=0 OR bookings>=bookings_goal) AND (commission_goal<=0 OR expected_commission>=commission_goal))',
                       '((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))');
  ELSE
   b3 := format('(CASE WHEN t.%s IS NULL THEN 3 ELSE t.reservations_target END)', k);
   c5 := format('(CASE WHEN t.%s IS NULL THEN 5400 ELSE t.booking_commission_target END)', k);
   def := replace(def, format('((%1$s>0 OR %2$s>0) AND (%1$s<=0 OR coalesce(b.reservations,0)>=%1$s) AND (%2$s<=0 OR coalesce(b.expected_commission,0)>=%2$s))', b3, c5),
     format('((CASE WHEN t.%1$s IS NULL THEN 2 ELSE t.reservations_target END)>0 AND coalesce(b.reservations,0)>=(CASE WHEN t.%1$s IS NULL THEN 2 ELSE t.reservations_target END) OR (CASE WHEN t.%1$s IS NULL THEN 4000 ELSE t.booking_commission_target END)>0 AND coalesce(b.expected_commission,0)>=(CASE WHEN t.%1$s IS NULL THEN 4000 ELSE t.booking_commission_target END))', k));
  END IF;
  def := replace(def, format('WHEN t.%s IS NULL THEN 3 ELSE t.reservations_target', k), format('WHEN t.%s IS NULL THEN 2 ELSE t.reservations_target', k));
  def := replace(def, format('WHEN t.%s IS NULL THEN 5400 ELSE t.booking_commission_target', k), format('WHEN t.%s IS NULL THEN 4000 ELSE t.booking_commission_target', k));
  def := replace(def, '''reservations_target'',3,''booking_commission_target'',5400', '''reservations_target'',2,''booking_commission_target'',4000');
  def := replace(def, 'jsonb_build_object(''inventory_target'',NULL::int,', 'jsonb_build_object(''inventory_target'',10,');
  EXECUTE def;
 END LOOP;
END $do$;
-- crm_repair_private.company_inventory_goal() stays: the reversed snapshot still reads it (its result is just not returned).
