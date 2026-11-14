-- SQL104 (14 Nov 2026, Ahmed, R59: «دراسة سعر جاهزة ودراسة سعر ملاك ينتظرون تسعيرك… اريد الموظفين ايضا يقدروا يشوفوا،
--   لان هذا يكون من ضمن عملهم… يشوفوا ويرسلوا من ارقام الافرع»). He chose: staff approve and send themselves, and they see
--   every number (owner net, commission, the internal report). This changes R37, where all of that was his alone.
--   1. The three price-study functions the screen uses were refused to everyone but the owner. Their first line now lets
--      the owner, a manager and an agent in; nothing else in their bodies changes (the body is read from the database,
--      checked against its md5 of 14 Nov 2026, and only that line is replaced):
--        crm_price_studies_pending()           the list, with the numbers and the two report paths
--        crm_price_study_decide(...)           approve (the study goes out from the chat's branch number, as before) or reject
--        crm_price_study_inspection_save(...)  «معاينة المكتب»
--      decided_by / created_by keep who did it.
--   2. Row rules: staff read owner_price_study_inspections of their company, read the private bucket «price-studies» (the
--      two reports and the inspection photos, through short signed links) and add / delete inspection photos there.
--   The tables owner_price_studies and owner_price_study_docs stay readable by the owner only (the screen reads through
--   the function). Nothing is sent to anyone by this file, and no row is changed.

SET LOCAL lock_timeout = '10s';

DO $gate$
DECLARE
  f record; v_def text; v_new text;
  c_old constant text := $o$if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;$o$;
  c_new constant text := $n$if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'agent') then raise exception 'owner_only' using errcode = '42501'; end if;$n$;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.crm_price_studies_pending()', '4619089f9e847ea17da42467205823d4'),
      ('public.crm_price_study_decide(uuid, boolean, text, text)', 'a5344ec6f3f5715954af8fbb709575cb'),
      ('public.crm_price_study_inspection_save(uuid, text, date, text[])', '9349ff1e93f19b9d8b414ca019320a7b')) AS v(sig, was)
  LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF position(c_new IN v_def) > 0 THEN CONTINUE; END IF;
    IF md5(v_def) <> f.was THEN
      RAISE EXCEPTION 'SQL104 refused: % changed since 14 Nov 2026 (md5 %)', f.sig, md5(v_def);
    END IF;
    v_new := replace(v_def, c_old, c_new);
    IF v_new = v_def THEN RAISE EXCEPTION 'SQL104 refused: the owner-only line was not found in %', f.sig; END IF;
    EXECUTE v_new;
  END LOOP;
END $gate$;

DROP POLICY IF EXISTS owner_price_study_inspections_owner_read ON public.owner_price_study_inspections;
DROP POLICY IF EXISTS owner_price_study_inspections_staff_read ON public.owner_price_study_inspections;
CREATE POLICY owner_price_study_inspections_staff_read ON public.owner_price_study_inspections FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));

DROP POLICY IF EXISTS crm_price_studies_owner_read ON storage.objects;
DROP POLICY IF EXISTS crm_price_studies_staff_read ON storage.objects;
CREATE POLICY crm_price_studies_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'price-studies' AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));

DROP POLICY IF EXISTS crm_price_study_inspection_owner_insert ON storage.objects;
DROP POLICY IF EXISTS crm_price_study_inspection_staff_insert ON storage.objects;
CREATE POLICY crm_price_study_inspection_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));

DROP POLICY IF EXISTS crm_price_study_inspection_owner_delete ON storage.objects;
DROP POLICY IF EXISTS crm_price_study_inspection_staff_delete ON storage.objects;
CREATE POLICY crm_price_study_inspection_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections' AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));
