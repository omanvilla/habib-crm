-- Rollback of SQL140: step 3 back to the SQL90/SQL60 choice (v2 when UTILITY, else v1), no day trigger, no step-F functions.
-- The column source_conversation_id is kept (rows of kind branch_transfer may hold it); drop it by hand once none is left.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_visit_followup_template(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.whatsapp_template_registry t
      WHERE t.route_key = p_route AND t.template_name = 'visit_followup_' || p_step || '_ar_v2'
        AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY')
    THEN 'visit_followup_' || p_step || '_ar_v2' ELSE 'visit_followup_' || p_step || '_ar_v1' END
$function$;

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

DROP TRIGGER IF EXISTS crm_visit_followup_fill_day ON public.whatsapp_visit_followups;
DROP FUNCTION IF EXISTS crm_repair_private.visit_followup_fill_day();
DROP FUNCTION IF EXISTS public.crm_branch_transfer_queue(uuid, text, text);
DROP FUNCTION IF EXISTS public.crm_branch_transfer_target(uuid);
DROP FUNCTION IF EXISTS public.crm_branch_transfer_close_source(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.ar_day_month(date);
