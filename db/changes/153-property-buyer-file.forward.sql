-- SQL153 (21 Nov 2026, Ahmed: «ملف العقار للمشتري… ممتاز هذا»): a one-page file for the buyer, opened by a link
-- (property-file.html?t=<token>): the property, its photos, which papers are ready, and what building it would cost today
-- from the monthly building-materials study. Nothing private leaves: no owner name or phone, no owner net or commission,
-- no plot number and no map pin (the location goes to the buyer when the visit is set, as today).

-- 1. cost per built m² by finish, from the «أسعار مواد البناء» tab (study of 3 Nov 2026); the monthly study updates it
CREATE TABLE IF NOT EXISTS public.crm_build_cost_rates (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('اقتصادي', 'متوسط', 'فاخر')),
  rate_per_m2 numeric NOT NULL CHECK (rate_per_m2 > 0),
  study_date date NOT NULL,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, tier)
);
ALTER TABLE public.crm_build_cost_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company reads build cost rates" ON public.crm_build_cost_rates;
CREATE POLICY "company reads build cost rates" ON public.crm_build_cost_rates FOR SELECT TO authenticated USING (company_id = public.my_company());
INSERT INTO public.crm_build_cost_rates (company_id, tier, rate_per_m2, study_date, source)
SELECT c.id, t.tier, t.rate, date '2026-11-03', 'تبويب «أسعار مواد البناء»: فيلا تسليم مفتاح'
  FROM public.companies c CROSS JOIN (VALUES ('اقتصادي', 180), ('متوسط', 235), ('فاخر', 360)) t(tier, rate)
ON CONFLICT (company_id, tier) DO NOTHING;

-- the monthly materials routine sets the new rates (nobody signed in can call it)
CREATE OR REPLACE FUNCTION public.crm_build_cost_rates_set(p_tier text, p_rate numeric, p_study_date date)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  WITH w AS (
    INSERT INTO public.crm_build_cost_rates (company_id, tier, rate_per_m2, study_date, source)
    SELECT c.id, p_tier, p_rate, p_study_date, 'تبويب «أسعار مواد البناء»: فيلا تسليم مفتاح' FROM public.companies c
    ON CONFLICT (company_id, tier) DO UPDATE SET rate_per_m2 = excluded.rate_per_m2, study_date = excluded.study_date, updated_at = now()
    RETURNING 1)
  SELECT count(*)::integer FROM w;
$$;
REVOKE ALL ON FUNCTION public.crm_build_cost_rates_set(text, numeric, date) FROM public, anon, authenticated;

-- 2. what the file says about the papers and the finish (set when the file is made)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS file_docs jsonb,
  ADD COLUMN IF NOT EXISTS file_finish text CHECK (file_finish IN ('اقتصادي', 'متوسط', 'فاخر')),
  ADD COLUMN IF NOT EXISTS file_build_year integer CHECK (file_build_year BETWEEN 1950 AND 2100);

-- 3. the links (read only through the functions below)
CREATE TABLE IF NOT EXISTS public.property_file_links (
  token text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_count integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz
);
ALTER TABLE public.property_file_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_property_file_link(p_property uuid, p_docs jsonb DEFAULT NULL, p_finish text DEFAULT NULL, p_build_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
declare v_company uuid := public.my_company(); v_token text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'agent') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property and p.company_id = v_company and crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)) then raise exception 'property_not_found'; end if;
  if p_finish is not null and p_finish not in ('اقتصادي', 'متوسط', 'فاخر') then raise exception 'finish_must_be_tier'; end if;
  update public.properties set file_docs = coalesce(p_docs, file_docs), file_finish = coalesce(p_finish, file_finish),
         file_build_year = coalesce(p_build_year, file_build_year)
   where id = p_property;
  select l.token into v_token from public.property_file_links l where l.property_id = p_property order by l.created_at limit 1;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '');
    insert into public.property_file_links (token, company_id, property_id, created_by) values (v_token, v_company, p_property, auth.uid());
  end if;
  return jsonb_build_object('token', v_token);
end $$;
REVOKE ALL ON FUNCTION public.crm_property_file_link(uuid, jsonb, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_property_file_link(uuid, jsonb, text, integer) TO authenticated;

-- 4. the page reads only this (anon): public fields, the papers, and the cost estimate.
-- Depreciation as in the study: 45-year life, 15% left at the end, at most 85%.
CREATE OR REPLACE FUNCTION public.crm_property_file_public(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
declare l record; p record; v_rate numeric; v_date date; v_age int; v_dep numeric; v_new numeric;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into l from public.property_file_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into p from public.properties where id = l.property_id;
  if not found or coalesce(p.archived, false) or p.status in ('sold', 'not_available') then return jsonb_build_object('ok', false, 'error', 'not_available'); end if;
  update public.property_file_links set opened_count = opened_count + 1, last_opened_at = now() where token = p_token;
  if p.built_size > 0 then
    select r.rate_per_m2, r.study_date into v_rate, v_date from public.crm_build_cost_rates r where r.company_id = p.company_id and r.tier = coalesce(p.file_finish, 'متوسط');
    v_age := case when p.file_build_year is not null then greatest(0, extract(year from now())::int - p.file_build_year) end;
    v_new := round(p.built_size * v_rate, -2);
    v_dep := case when v_age is not null then least(0.85, v_age::numeric / 45 * 0.85) end;
  end if;
  return jsonb_build_object('ok', true,
    'type', p.type, 'area', p.area, 'wilayat', p.wilayat, 'status', p.status,
    'price', p.price, 'price_negotiable', p.price_negotiable, 'land_size', p.land_size, 'built_size', p.built_size,
    'bedrooms', p.bedrooms, 'bathrooms', p.bathrooms, 'images', to_jsonb(coalesce(p.images, '{}'::text[])),
    'details', p.public_details, 'electricity', p.electricity_connected, 'water', p.water_connected,
    'docs', p.file_docs, 'finish', p.file_finish, 'build_year', p.file_build_year,
    'cost', case when v_rate is null then null else jsonb_build_object('rate', v_rate, 'tier', coalesce(p.file_finish, 'متوسط'), 'study_date', v_date,
      'new_cost', v_new, 'age', v_age, 'depreciation', v_dep, 'now_cost', case when v_dep is not null then round(v_new * (1 - v_dep), -2) end) end,
    'branch_phone', case when p.branch_key = 'muscat' then '96871770030' else '96892344273' end);
end $$;
REVOKE ALL ON FUNCTION public.crm_property_file_public(text) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_property_file_public(text) TO anon, authenticated;
