-- SQL152 (21 Nov 2026, Ahmed: «درجة العقار حسب الأوراق، نعم هذا أوكي»): every owner offer gets a document grade A/B/C.
-- A: ownership deed + krookie (+ completion certificate for a building) from the owner himself, no mortgage.
-- B: deed + krookie, but something else is missing (completion certificate, drawings, warranties, age).
-- C: deed or krookie missing, or not the owner and no power of attorney: no study and no listing until the papers come.
-- The pricing routine sets it with crm_price_study_grade after it reads the documents; the studies screen shows it.

ALTER TABLE public.owner_leads
  ADD COLUMN IF NOT EXISTS doc_grade text CHECK (doc_grade IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS doc_checklist jsonb,
  ADD COLUMN IF NOT EXISTS doc_grade_note text,
  ADD COLUMN IF NOT EXISTS doc_graded_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_price_study_grade(p_task_id uuid, p_grade text, p_checklist jsonb DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
declare v_lead uuid;
begin
  if p_grade is null or p_grade not in ('A', 'B', 'C') then raise exception 'grade_must_be_A_B_C'; end if;
  select t.owner_lead_id into v_lead from public.tasks t where t.id = p_task_id;
  if v_lead is null then
    select s.owner_lead_id into v_lead from public.owner_price_studies s where s.task_id = p_task_id and s.owner_lead_id is not null order by s.created_at desc limit 1;
  end if;
  if v_lead is null then return jsonb_build_object('ok', false, 'error', 'no_owner_lead'); end if;
  update public.owner_leads
     set doc_grade = p_grade, doc_checklist = coalesce(p_checklist, doc_checklist), doc_grade_note = nullif(p_note, ''), doc_graded_at = now()
   where id = v_lead;
  return jsonb_build_object('ok', true, 'owner_lead_id', v_lead, 'grade', p_grade);
end $$;
REVOKE ALL ON FUNCTION public.crm_price_study_grade(uuid, text, jsonb, text) FROM public, anon, authenticated;

-- the studies screen gets the grade beside each study
DO $do$
declare d text;
begin
  d := pg_get_functiondef('public.crm_price_studies_pending()'::regprocedure);
  if position('l.doc_grade' in d) = 0 then
    d := replace(d, 's.office_outreach,', 's.office_outreach, l.doc_grade, l.doc_checklist, l.doc_grade_note,');
    if position('l.doc_grade' in d) = 0 then raise exception 'crm_price_studies_pending: anchor not found'; end if;
    execute d;
  end if;
end $do$;
