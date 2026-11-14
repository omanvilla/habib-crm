-- Rollback of SQL104: price studies are the owner's alone again (the three functions, the inspections table and the
-- private bucket). Decisions and inspections staff already made stay as history.
SET LOCAL lock_timeout = '10s';

DO $gate$
DECLARE
  sig text; v_def text;
  c_old constant text := $o$if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;$o$;
  c_new constant text := $n$if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'agent') then raise exception 'owner_only' using errcode = '42501'; end if;$n$;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.crm_price_studies_pending()', 'public.crm_price_study_decide(uuid, boolean, text, text)',
                             'public.crm_price_study_inspection_save(uuid, text, date, text[])']
  LOOP
    v_def := pg_get_functiondef(sig::regprocedure);
    IF position(c_new IN v_def) > 0 THEN EXECUTE replace(v_def, c_new, c_old); END IF;
  END LOOP;
END $gate$;

DROP POLICY IF EXISTS owner_price_study_inspections_staff_read ON public.owner_price_study_inspections;
DROP POLICY IF EXISTS owner_price_study_inspections_owner_read ON public.owner_price_study_inspections;
CREATE POLICY owner_price_study_inspections_owner_read ON public.owner_price_study_inspections FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');

DROP POLICY IF EXISTS crm_price_studies_staff_read ON storage.objects;
DROP POLICY IF EXISTS crm_price_studies_owner_read ON storage.objects;
CREATE POLICY crm_price_studies_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'price-studies' AND (SELECT public.my_role()) = 'owner');

DROP POLICY IF EXISTS crm_price_study_inspection_staff_insert ON storage.objects;
DROP POLICY IF EXISTS crm_price_study_inspection_owner_insert ON storage.objects;
CREATE POLICY crm_price_study_inspection_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) = 'owner');

DROP POLICY IF EXISTS crm_price_study_inspection_staff_delete ON storage.objects;
DROP POLICY IF EXISTS crm_price_study_inspection_owner_delete ON storage.objects;
CREATE POLICY crm_price_study_inspection_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) = 'owner');
