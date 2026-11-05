-- Rollback for SQL60. Publish the front end without crm-owner-home.js first.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.crm_queue_visit_followups(integer)'::regprocedure);
  EXECUTE replace(d, $q$public.crm_visit_followup_text(v_total + 1, c.route_key), public.crm_visit_followup_template(v_total + 1, c.route_key)$q$,
                     $q$public.crm_visit_followup_text(v_total + 1), 'visit_followup_' || (v_total + 1) || '_ar_v1'$q$);
END
$do$;
DROP FUNCTION IF EXISTS public.crm_visit_followup_text(integer, text);
DROP FUNCTION IF EXISTS public.crm_visit_followup_template(integer, text);
DROP FUNCTION IF EXISTS public.crm_owner_home();
DROP TRIGGER IF EXISTS crm_pick_viewing_request ON public.viewings;
DROP FUNCTION IF EXISTS crm_repair_private.pick_viewing_request();
