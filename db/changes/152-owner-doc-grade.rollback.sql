-- SQL152 rollback: the screen stops reading the grade and the function goes. The columns stay (no data is dropped).
DO $do$
declare d text;
begin
  d := pg_get_functiondef('public.crm_price_studies_pending()'::regprocedure);
  d := replace(d, ' l.doc_grade, l.doc_checklist, l.doc_grade_note,', '');
  execute d;
end $do$;
DROP FUNCTION IF EXISTS public.crm_price_study_grade(uuid, text, jsonb, text);
