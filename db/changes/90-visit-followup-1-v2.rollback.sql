-- Rollback of SQL90: crm_visit_followup_text(integer,text) as it was on 12 Nov 2026 (md5 fb45d5491d5e7c9e7f6daa7aba4b0232).
-- With visit_followup_1_ar_v2 approved, step 1 would then fall back to the version 1 text; withdraw the template too.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_visit_followup_text(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.crm_visit_followup_template(p_step, p_route) LIKE '%_v1' THEN public.crm_visit_followup_text(p_step)
    WHEN p_step = 2 THEN 'بخصوص زيارتك الاخيرة للعقار هل عندك ملاحظة عليه ؟'
    WHEN p_step = 3 THEN 'بخصوص زيارتك الاخيرة للعقار هل وصلت لقرار ؟'
    WHEN p_step = 4 THEN 'نراجع طلبك المسجل عندنا هل طلبك لين الحين قائم ؟'
    ELSE public.crm_visit_followup_text(p_step) END
$function$;
REVOKE ALL ON FUNCTION public.crm_visit_followup_text(integer, text) FROM PUBLIC, anon, authenticated;
