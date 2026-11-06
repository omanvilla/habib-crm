-- SQL74 (6 Nov 2026, owner's request): «تم» on a hot alert for a handed-over chat is saved in the database, not only in
-- the browser, so pressing it on the computer also hides it on the phone. The alert comes back when the chat is handed
-- over again (handoff_updated_at later than owner_alert_done_at). Owner only; branch accounts cannot call it.
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS owner_alert_done_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_hot_alert_done(p_conversation_id uuid)
 RETURNS timestamptz
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
REVOKE ALL ON FUNCTION public.crm_hot_alert_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_hot_alert_done(uuid) TO authenticated, service_role;
