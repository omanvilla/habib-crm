-- Rollback of SQL88: «تم» only stores its time again (the column stays, unused).
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION public.crm_hot_alert_done(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_at timestamptz := now();
BEGIN
  IF v_company IS NULL OR public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_conversations SET owner_alert_done_at = v_at
   WHERE id = p_conversation_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_at;
END
$function$;
