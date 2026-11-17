-- SQL113 (17 Nov 2026, Ahmed): «في الشهر 200 ما منطقي … خلي التارجت 100 اتصال مبدئيا الشهر الأول، الشهر الثاني نبدأ نزيد شوية شوية».
-- He chose: 10 a day and the week as the sum of its days stay (SQL110); the MONTH has its own target that he sets, 100 for November 2026.
--   crm_call_month_targets(company, month, target): one number per calendar month for each staff member. A month without a row keeps the
--   SQL110 sum (10 × working days, minus holidays and leave).
--   crm_set_call_month_target(p_month, p_target): owner only; p_target NULL removes the month's number.
--   crm_calls_today(): the month's target is the saved number when there is one ('fixed': true), for the person and for each person.
-- Rollback: 113-call-month-target.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_calls_today()'::regprocedure)) <> 'baebdf54686f30be195ab2c1687a2719' THEN
    RAISE EXCEPTION 'SQL113 refused: crm_calls_today changed since SQL110, read it again first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_call_month_targets (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  target integer NOT NULL CHECK (target BETWEEN 1 AND 2000),
  set_by uuid NOT NULL REFERENCES public.profiles(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, month)
);
ALTER TABLE public.crm_call_month_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_call_month_targets FROM PUBLIC, anon, authenticated;

-- the month of one person: calls from call_sum, target = the saved number of that month, else the SQL110 sum
CREATE OR REPLACE FUNCTION crm_repair_private.call_month(p_company uuid, p_user uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN t.target IS NULL THEN s ELSE s || jsonb_build_object('target', t.target, 'fixed', true) END
    FROM (SELECT crm_repair_private.call_sum(p_company, p_user, p_from, p_to) AS s) x
    LEFT JOIN public.crm_call_month_targets t ON t.company_id = p_company AND t.month = date_trunc('month', p_from)::date;
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.call_month(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_set_call_month_target(p_month date, p_target integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); m date := date_trunc('month', p_month)::date;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') <> 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF p_month IS NULL THEN RAISE EXCEPTION 'month_required' USING ERRCODE = '22023'; END IF;
  IF p_target IS NULL THEN
    DELETE FROM public.crm_call_month_targets WHERE company_id = c AND month = m;
    RETURN jsonb_build_object('ok', true, 'month', m, 'target', NULL);
  END IF;
  IF p_target < 1 OR p_target > 2000 THEN RAISE EXCEPTION 'target_1_to_2000' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.crm_call_month_targets (company_id, month, target, set_by) VALUES (c, m, p_target, u)
  ON CONFLICT (company_id, month) DO UPDATE SET target = excluded.target, set_by = excluded.set_by, set_at = now();
  RETURN jsonb_build_object('ok', true, 'month', m, 'target', p_target);
END $function$;
REVOKE ALL ON FUNCTION public.crm_set_call_month_target(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_call_month_target(date, integer) TO authenticated;

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
    'month', crm_repair_private.call_month(c, u, m0, m1),
    'people', CASE WHEN r IN ('owner', 'manager') THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name,
               'calls', ((crm_repair_private.call_sum(c, p.user_id, d, d)) ->> 'calls')::int,
               'target', crm_repair_private.call_day_target(c, p.user_id, d),
               'week', crm_repair_private.call_sum(c, p.user_id, w0, w0 + 6),
               'month', crm_repair_private.call_month(c, p.user_id, m0, m1)) ORDER BY p.name), '[]'::jsonb)
        FROM crm_repair_private.call_people(c, m0) p) ELSE '[]'::jsonb END);
END $function$;
