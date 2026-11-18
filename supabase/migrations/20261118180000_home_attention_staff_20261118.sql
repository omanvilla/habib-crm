-- SQL130 (18 Nov 2026, Ahmed: «افتح المشترين والعقود للموظف»). «مشترين واقفين» and «العقود» (SQL126/127) were owner only.
-- Staff (manager, agent) now read them too, each row only where they can already go: a waiting buyer's chat by
-- crm_repair_private.can_access_whatsapp_conversation (their chat list rule), a property by staff_can_access_branch (the
-- properties RLS), a new brokerage contract by its chat. «تم» on a buyer and «متوفر» on a property follow the same rules.
-- No money is in these answers (the accepted study gives the owner's name, phone, the property type and place only).
-- Only the role check and the access conditions change; each body is changed by exact string replacement, counted.
-- Rollback: 130-home-attention-staff.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE d text; n int;
  own text := 'SELECT p.company_id INTO v_company FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ''owner'' AND p.is_active;';
  staff text := 'SELECT p.company_id, p.role = ''owner'' INTO v_company, v_owner FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''owner'', ''manager'', ''agent'') AND p.is_active;';
  cnt_fn text;
BEGIN
  -- crm_home_attention
  d := pg_get_functiondef('public.crm_home_attention()'::regprocedure);
  IF position(own in d) = 0 OR position('DECLARE v_company uuid;' in d) = 0 THEN RAISE EXCEPTION 'SQL130 refused: crm_home_attention changed'; END IF;
  d := replace(d, 'DECLARE v_company uuid;', 'DECLARE v_company uuid; v_owner boolean := false;');
  d := replace(d, own, staff);
  n := (length(d) - length(replace(d, 'AND w.ignored_at IS NULL', ''))) / length('AND w.ignored_at IS NULL');
  IF n <> 1 THEN RAISE EXCEPTION 'SQL130 refused: waiting filter (% matches)', n; END IF;
  d := replace(d, 'AND w.ignored_at IS NULL', 'AND w.ignored_at IS NULL' || E'\n       AND (v_owner OR crm_repair_private.can_access_whatsapp_conversation(v_company, w.id))');
  n := (length(d) - length(replace(d, 'AND p.status IN (''available'', ''reserved'')', ''))) / length('AND p.status IN (''available'', ''reserved'')');
  IF n <> 2 THEN RAISE EXCEPTION 'SQL130 refused: property filters (% matches)', n; END IF;
  d := replace(d, 'AND p.status IN (''available'', ''reserved'')', 'AND p.status IN (''available'', ''reserved'') AND (v_owner OR crm_repair_private.staff_can_access_branch(v_company, p.branch_key))');
  n := (length(d) - length(replace(d, 'AND s.owner_reaction = ''accepted''', ''))) / length('AND s.owner_reaction = ''accepted''');
  IF n <> 1 THEN RAISE EXCEPTION 'SQL130 refused: contracts filter (% matches)', n; END IF;
  d := replace(d, 'AND s.owner_reaction = ''accepted''', 'AND s.owner_reaction = ''accepted'' AND (v_owner OR (s.conversation_id IS NOT NULL AND crm_repair_private.can_access_whatsapp_conversation(v_company, s.conversation_id)))');
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public.crm_waiting_buyer_done(p_conversation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_owner boolean := false;
BEGIN
  SELECT p.company_id, p.role = 'owner' INTO v_company, v_owner FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'agent') AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  IF NOT v_owner AND NOT crm_repair_private.can_access_whatsapp_conversation(v_company, p_conversation) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.whatsapp_conversations SET waiting_done_at = now() WHERE id = p_conversation AND company_id = v_company;
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.crm_waiting_buyer_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_waiting_buyer_done(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_property_confirm_available(p_property uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_owner boolean := false; v_branch text;
BEGIN
  SELECT p.company_id, p.role = 'owner' INTO v_company, v_owner FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'agent') AND p.is_active;
  IF v_company IS NULL THEN RAISE EXCEPTION 'owner_only'; END IF;
  SELECT x.branch_key INTO v_branch FROM public.properties x WHERE x.id = p_property AND x.company_id = v_company;
  IF NOT v_owner AND NOT crm_repair_private.staff_can_access_branch(v_company, v_branch) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.properties SET availability_checked_at = now() WHERE id = p_property AND company_id = v_company;
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.crm_property_confirm_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_property_confirm_available(uuid) TO authenticated;
