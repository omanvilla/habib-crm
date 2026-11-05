-- SQL58: owner type "agent", Ahmed's presence and notes on a visit, and one safe way to add a property with its owner.

-- An agent is the contact for the property; the real owner and the proof of authority are kept beside it.
ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS original_owner_name text,
  ADD COLUMN IF NOT EXISTS kinship text,
  ADD COLUMN IF NOT EXISTS has_power_of_attorney boolean;
UPDATE public.owners SET owner_type = 'agent', kinship = coalesce(kinship, 'والده'), has_power_of_attorney = coalesce(has_power_of_attorney, true)
 WHERE coalesce(owner_type, 'owner') = 'owner' AND relationship_type = 'agent'; -- one record on 5 Nov 2026

-- NULL = not said yet, true = Ahmed was there, false = the customer went alone.
ALTER TABLE public.viewings
  ADD COLUMN IF NOT EXISTS ahmed_present boolean,
  ADD COLUMN IF NOT EXISTS owner_visit_notes text;

-- Owner's screen, or a server/Claude session with no signed-in user. Notes are added, never overwritten.
CREATE OR REPLACE FUNCTION public.crm_set_visit_presence(p_viewing_id uuid, p_present boolean DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_row public.viewings; v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF auth.uid() IS NOT NULL AND public.my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.viewings v SET
    ahmed_present = coalesce(p_present, CASE WHEN v_note IS NOT NULL THEN true END, v.ahmed_present),
    owner_visit_notes = CASE WHEN v_note IS NULL THEN v.owner_visit_notes
      ELSE concat_ws(E'\n\n', v.owner_visit_notes, to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || ': ' || v_note) END
  WHERE v.id = p_viewing_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'viewing_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'ahmed_present', v_row.ahmed_present, 'owner_visit_notes', v_row.owner_visit_notes);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_set_visit_presence(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_visit_presence(uuid, boolean, text) TO authenticated, service_role;

-- Adds a property and its owner or agent in one step. The owner is reused by phone number; running it twice with
-- the same owner and title returns the same property. See docs/add-property-from-claude.md.
CREATE OR REPLACE FUNCTION public.crm_add_property_with_owner(p_owner jsonb, p_property jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid; v_company uuid; v_owner uuid; v_prop uuid; v_owner_new boolean := false;
  v_phone text := regexp_replace(coalesce(p_owner->>'phone', ''), '\D', '', 'g');
  v_name text := nullif(btrim(coalesce(p_owner->>'name', '')), '');
  v_title text := nullif(btrim(coalesce(p_property->>'title', '')), '');
  v_area text := nullif(btrim(coalesce(p_property->>'area', '')), '');
  v_branch text := p_property->>'branch_key';
  v_price numeric := nullif(p_property->>'price', '')::numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND public.my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501';
  END IF;
  SELECT id, company_id INTO v_actor, v_company FROM public.profiles WHERE role = 'owner' AND is_active ORDER BY created_at LIMIT 1;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_profile_missing'; END IF;
  IF v_name IS NULL OR length(v_phone) < 8 THEN RAISE EXCEPTION 'owner_name_and_phone_required' USING ERRCODE = '22023'; END IF;
  IF v_title IS NULL OR v_area IS NULL OR coalesce(v_price, 0) <= 0 THEN RAISE EXCEPTION 'title_area_price_required' USING ERRCODE = '22023'; END IF;
  IF v_branch IS NULL OR v_branch NOT IN ('barka', 'muscat', 'investment', 'general') THEN RAISE EXCEPTION 'branch_key_required' USING ERRCODE = '22023'; END IF;

  SELECT o.id INTO v_owner FROM public.owners o
   WHERE o.company_id = v_company AND right(regexp_replace(o.phone, '\D', '', 'g'), 8) = right(v_phone, 8)
   ORDER BY coalesce(o.archived, false), o.created_at LIMIT 1;
  IF v_owner IS NULL THEN
    INSERT INTO public.owners (company_id, added_by, name, phone, owner_type, relationship_type, original_owner_name, kinship, has_power_of_attorney, notes, archived)
    VALUES (v_company, v_actor, v_name, '+' || v_phone, coalesce(nullif(p_owner->>'owner_type', ''), 'owner'),
      CASE WHEN p_owner->>'owner_type' = 'agent' THEN 'agent' ELSE 'owner' END,
      p_owner->>'original_owner_name', p_owner->>'kinship', (p_owner->>'has_power_of_attorney')::boolean, p_owner->>'notes', false)
    RETURNING id INTO v_owner;
    v_owner_new := true;
  END IF;

  SELECT p.id INTO v_prop FROM public.properties p WHERE p.company_id = v_company AND p.owner_id = v_owner AND p.title = v_title AND NOT p.archived LIMIT 1;
  IF v_prop IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'owner_id', v_owner, 'owner_created', v_owner_new, 'property_id', v_prop, 'property_created', false);
  END IF;

  INSERT INTO public.properties (company_id, added_by, sourced_by, owner_id, title, internal_name, type, area, wilayat, price, owner_net, expected_commission,
    bedrooms, bathrooms, land_size, built_size, description, map_url, branch_key, listing_purpose, visit_method, visit_instructions, status, source_type, marketing_status, archived)
  VALUES (v_company, v_actor, v_actor, v_owner, v_title, coalesce(p_property->>'internal_name', v_title), coalesce(nullif(p_property->>'type', ''), 'villa'), v_area, p_property->>'wilayat', v_price,
    nullif(p_property->>'owner_net', '')::numeric, nullif(p_property->>'expected_commission', '')::numeric,
    nullif(p_property->>'bedrooms', '')::int, nullif(p_property->>'bathrooms', '')::int, nullif(p_property->>'land_size', '')::numeric, nullif(p_property->>'built_size', '')::numeric,
    p_property->>'description', p_property->>'map_url', v_branch, coalesce(nullif(p_property->>'listing_purpose', ''), 'sale'),
    nullif(p_property->>'visit_method', ''), p_property->>'visit_instructions', 'available', coalesce(nullif(p_property->>'source_type', ''), 'owner'), coalesce(nullif(p_property->>'marketing_status', ''), 'needs_photos'), false)
  RETURNING id INTO v_prop;
  RETURN jsonb_build_object('ok', true, 'owner_id', v_owner, 'owner_created', v_owner_new, 'property_id', v_prop, 'property_created', true);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_add_property_with_owner(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_add_property_with_owner(jsonb, jsonb) TO authenticated, service_role;
