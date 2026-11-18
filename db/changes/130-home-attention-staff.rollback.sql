-- Rollback SQL130: «مشترين واقفين» and «العقود» are owner only again (the SQL126/127 bodies).
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.crm_home_attention()'::regprocedure);
  d := replace(d, 'DECLARE v_company uuid; v_owner boolean := false;', 'DECLARE v_company uuid;');
  d := replace(d, 'SELECT p.company_id, p.role = ''owner'' INTO v_company, v_owner FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''owner'', ''manager'', ''agent'') AND p.is_active;',
                  'SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ''owner'' AND p.is_active;');
  d := replace(d, E'\n       AND (v_owner OR crm_repair_private.can_access_whatsapp_conversation(v_company, w.id))', '');
  d := replace(d, ' AND (v_owner OR crm_repair_private.staff_can_access_branch(v_company, p.branch_key))', '');
  d := replace(d, ' AND (v_owner OR (s.conversation_id IS NOT NULL AND crm_repair_private.can_access_whatsapp_conversation(v_company, s.conversation_id)))', '');
  EXECUTE d;
END $$;
CREATE OR REPLACE FUNCTION public.crm_waiting_buyer_done(p_conversation uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  UPDATE public.whatsapp_conversations SET waiting_done_at = now() WHERE id = p_conversation AND company_id = v_company;
  RETURN FOUND;
END $function$;
CREATE OR REPLACE FUNCTION public.crm_property_confirm_available(p_property uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner' AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  UPDATE public.properties SET availability_checked_at = now() WHERE id = p_property AND company_id = v_company;
  RETURN FOUND;
END $function$;
