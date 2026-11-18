-- SQL128 (18 Nov 2026, Ahmed: «اريد قائمة عملاء يحتاجونك الحين تظهر للموظفه او الموظف ايضا عشان في اشخاص هما يردوا عليهم ما
-- يحتاج انا اتدخل»). «تم» on a hot alert (crm_hot_alert_done, SQL74 / SQL88) was owner only. Now staff (manager, agent) may
-- press it too on a chat they can open (crm_repair_private.can_access_whatsapp_conversation, the same rule as their chat list),
-- and it is one shared «تم»: whoever handles the client, the row leaves everyone's list. Who pressed it is kept
-- (owner_alert_done_by). The screen (crm-hot-alerts.js) shows the list to staff with their own branch chats.
-- Rollback: 128-hot-alerts-staff.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS owner_alert_done_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.crm_hot_alert_done(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_role text := public.my_role(); v_at timestamptz := now();
BEGIN
  IF v_company IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_role <> 'owner' AND NOT crm_repair_private.can_access_whatsapp_conversation(v_company, p_conversation_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.whatsapp_conversations SET owner_alert_done_at = v_at, owner_alert_done_reason = left(handoff_reason, 500), owner_alert_done_by = auth.uid()
   WHERE id = p_conversation_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_at;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_hot_alert_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_hot_alert_done(uuid) TO authenticated;
