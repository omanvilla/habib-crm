-- Rollback of SQL113: the month target is the SQL110 sum again; crm_call_month_targets is kept (drop by hand if wanted).
SET LOCAL lock_timeout = '10s';

DROP FUNCTION IF EXISTS public.crm_set_call_month_target(date, integer);

CREATE OR REPLACE FUNCTION public.crm_calls_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); r text := coalesce(public.my_role(), '');
  d date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  w0 date; m0 date := date_trunc('month', d)::date; m1 date;
BEGIN
  IF u IS NULL OR c IS NULL OR r NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  w0 := d - (extract(dow FROM d))::int;            -- Sunday
  m1 := (m0 + interval '1 month')::date - 1;
  RETURN jsonb_build_object('day', d, 'daily_target', 10,
    'target', crm_repair_private.call_day_target(c, u, d),
    'mine', ((crm_repair_private.call_sum(c, u, d, d)) ->> 'calls')::int,
    'week', crm_repair_private.call_sum(c, u, w0, w0 + 6),
    'month', crm_repair_private.call_sum(c, u, m0, m1),
    'people', CASE WHEN r IN ('owner', 'manager') THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name,
               'calls', ((crm_repair_private.call_sum(c, p.user_id, d, d)) ->> 'calls')::int,
               'target', crm_repair_private.call_day_target(c, p.user_id, d),
               'week', crm_repair_private.call_sum(c, p.user_id, w0, w0 + 6),
               'month', crm_repair_private.call_sum(c, p.user_id, m0, m1)) ORDER BY p.name), '[]'::jsonb)
        FROM crm_repair_private.call_people(c, m0) p) ELSE '[]'::jsonb END);
END $function$;

DROP FUNCTION IF EXISTS crm_repair_private.call_month(uuid, uuid, date, date);
