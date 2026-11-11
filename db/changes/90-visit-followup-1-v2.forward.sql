-- SQL90 (12 Nov 2026, Ahmed: «كيف لقيته» — «غيره ما نريد كذا»): step 1 of the visit follow-up gets version 2 of its Meta
-- template, «السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟» (R29 wording without the property name, a template has no
-- variable). crm_visit_followup_template already picks visit_followup_1_ar_v2 for a number once Meta approves it as
-- UTILITY; until then version 1 stays in use. This only adds the step-1 text for version 2.
-- Rollback: 90-visit-followup-1-v2.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_visit_followup_text(integer,text)'::regprocedure)) <> 'fb45d5491d5e7c9e7f6daa7aba4b0232' THEN
    RAISE EXCEPTION 'SQL90 refused: crm_visit_followup_text(integer,text) changed since 12 Nov 2026';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.crm_visit_followup_text(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.crm_visit_followup_template(p_step, p_route) LIKE '%_v1' THEN public.crm_visit_followup_text(p_step)
    WHEN p_step = 1 THEN 'السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟'
    WHEN p_step = 2 THEN 'بخصوص زيارتك الاخيرة للعقار هل عندك ملاحظة عليه ؟'
    WHEN p_step = 3 THEN 'بخصوص زيارتك الاخيرة للعقار هل وصلت لقرار ؟'
    WHEN p_step = 4 THEN 'نراجع طلبك المسجل عندنا هل طلبك لين الحين قائم ؟'
    ELSE public.crm_visit_followup_text(p_step) END
$function$;
REVOKE ALL ON FUNCTION public.crm_visit_followup_text(integer, text) FROM PUBLIC, anon, authenticated;
