-- Permission check with the two test accounts (owner + staff), CLAUDE.md «فحص التعديلات بنفسك».
-- The accounts stay inactive, outside the company and banned from login in the live data,
-- so no listing, report, alert or "pick the owner" lookup can ever see them.
-- This block switches them on ONLY inside its own transaction, reads as each one through
-- RLS (role authenticated + JWT claims), adds one temporary client as the staff account,
-- then raises an exception on purpose so everything rolls back. Nothing is kept.
-- Account details live in tests/test-accounts.local.json (git-ignored). Run the DO block with execute_sql;
-- the "error" TEST_ACCOUNTS_RESULT {...} is the result. Expected: owner sees every count of "all" and
-- owner_line_client_visible=1; staff sees owner_line_client_visible=0, own_temp_client_visible=1 and 0 in
-- owner_price_studies, crm_owner_notes, instagram_media_catalog (both branches are shared by Ahmed's SQL79).
DO $chk$
DECLARE
  co   uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  own  uuid := (SELECT id FROM public.profiles WHERE email = 'owner-check@habib-crm.test');
  stf  uuid := (SELECT id FROM public.profiles WHERE email = 'staff-check@habib-crm.test');
  tbls text[] := ARRAY['clients','properties','deals','viewings','client_requests','activities',
    'whatsapp_conversations','notifications','profiles','expenses','owners','owner_leads',
    'owner_price_studies','investment_projects','instagram_media_catalog','crm_owner_notes'];
  -- SQL159: also checks properties.owner_net (denied to both directly) and the view's money rows (owner only)
  t text; n bigint; res jsonb := '{}'; one jsonb; who record; tmp uuid; priv uuid; ph text;
BEGIN
  UPDATE public.profiles SET company_id = co, is_active = true,
         role = CASE id WHEN own THEN 'owner' ELSE 'agent' END
   WHERE id IN (own, stf);
  -- a phone no real client has, for the temporary rows
  SELECT '+9680000' || lpad(g::text, 4, '0') INTO ph FROM generate_series(1, 9999) g
   WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.company_id = co
                     AND right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 8) = '0000' || lpad(g::text, 4, '0'))
   LIMIT 1;
  -- temporary client on the owner's private line: the owner must see it, staff must not
  INSERT INTO public.clients (company_id, name, phone, source, lead_route)
  VALUES (co, 'فحص خط المالك الخاص', ph, 'manual', 'owner') RETURNING id INTO priv;

  -- totals as superuser, for comparison
  one := '{}';
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n; one := one || jsonb_build_object(t, n);
    END IF;
  END LOOP;
  res := res || jsonb_build_object('all', one);

  FOR who IN SELECT * FROM (VALUES ('owner', own), ('staff', stf)) v(k, id) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    one := jsonb_build_object('my_role', public.my_role());
    SELECT count(*) INTO n FROM public.clients WHERE id = priv;
    one := one || jsonb_build_object('owner_line_client_visible', n);
    FOREACH t IN ARRAY tbls LOOP
      IF to_regclass('public.'||t) IS NOT NULL THEN
        BEGIN
          EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n; one := one || jsonb_build_object(t, n);
        EXCEPTION WHEN insufficient_privilege THEN one := one || jsonb_build_object(t, 'denied');
        END;
      END IF;
    END LOOP;
    -- temporary data for the staff account, written through RLS as that account
    IF who.k = 'staff' THEN
      BEGIN
        INSERT INTO public.clients (company_id, name, phone, assigned_to, source)
        VALUES (co, 'عميل فحص مؤقت', '+96800001' || right(ph, 3), stf, 'manual') RETURNING id INTO tmp;
        SELECT count(*) INTO n FROM public.clients WHERE id = tmp;
        one := one || jsonb_build_object('own_temp_client_visible', n);
      EXCEPTION WHEN OTHERS THEN one := one || jsonb_build_object('own_temp_client_error', SQLERRM);
      END;
    END IF;
    BEGIN PERFORM owner_net FROM public.properties LIMIT 1; one := one || '{"properties_owner_net":"readable"}';
    EXCEPTION WHEN insufficient_privilege THEN one := one || '{"properties_owner_net":"denied"}'; END;
    SELECT count(*) INTO n FROM public.crm_properties_access WHERE owner_net IS NOT NULL OR expected_commission IS NOT NULL;
    one := one || jsonb_build_object('view_money_rows', n);
    RESET ROLE;
    res := res || jsonb_build_object(who.k, one);
  END LOOP;

  RAISE EXCEPTION 'TEST_ACCOUNTS_RESULT %', res;  -- rolls everything back
END $chk$;
