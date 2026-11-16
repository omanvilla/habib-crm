-- SQL108 (16 Nov 2026, R88, Ahmed: «لما نريد نرسل الدراسة لشخص… نرسله كمحادثة… عن طريق الواتساب… ما نقص ننتظر رده»):
-- an approved study whose owner has not answered the «دراسة سعر عقارك جاهزة» template (or that could not be sent) is sent by the
-- office from the phone's WhatsApp, with the message and the report ready on the screen. This function records that it went:
-- the price-study function closes it exactly as an automatic send does (status sent, the task, the owner offer, the chat's
-- reason), so the study is not sent a second time when the owner answers. Staff only; nothing is sent by this function.
-- Rollback: 108-study-sent-by-phone.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_price_study_sent_by_phone(p_study_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); st text;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501';
  END IF;
  SELECT s.status INTO st FROM public.owner_price_studies s WHERE s.id = p_study_id AND s.company_id = c;
  IF st IS NULL THEN RAISE EXCEPTION 'study_not_found' USING ERRCODE = '22023'; END IF;
  IF st NOT IN ('waiting_owner', 'approved', 'send_failed') THEN RAISE EXCEPTION 'study_not_waiting' USING ERRCODE = '22023'; END IF;
  PERFORM crm_repair_private.price_study_call(jsonb_build_object('action', 'sent_by_phone', 'study_id', p_study_id, 'by', u));
  RETURN jsonb_build_object('ok', true, 'study_id', p_study_id);
END $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_sent_by_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_study_sent_by_phone(uuid) TO authenticated;

-- R88, second part (Ahmed, same day: «ما في هنا زر إن ألغي هذه الدراسة… دام إنه نرسل له اعتذار مفروض ينلغي من هنا من دراسة سعر»):
-- an owner who should not be priced (outside Muscat and Barka, a house people live in, he withdrew) leaves «ملاك ينتظرون تسعيرك»
-- with one button: the open «دراسة سعر» task closes with the reason (so it leaves the pricing queue), his open offers close
-- («ما نستلم: …»), a study not yet sent is cancelled, and the chat goes back to the agent. Nothing is sent to the owner.
CREATE OR REPLACE FUNCTION public.crm_price_study_drop(p_conversation_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); cl uuid; why text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
  n_tasks int; n_leads int; n_studies int;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501';
  END IF;
  IF why IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  SELECT w.client_id INTO cl FROM public.whatsapp_conversations w
   WHERE w.id = p_conversation_id AND w.company_id = c AND w.human_handoff_required AND w.handoff_reason ~ '^\s*دراسة\s*سعر';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_price_study_chat' USING ERRCODE = '22023'; END IF;
  UPDATE public.owner_price_studies s SET status = 'cancelled', reject_note = left('الغاء من القائمة: ' || why, 500), decided_at = now(), decided_by = u, updated_at = now()
   WHERE s.company_id = c AND s.conversation_id = p_conversation_id AND s.status IN ('submitted', 'awaiting_approval', 'approved', 'waiting_owner', 'send_failed');
  GET DIAGNOSTICS n_studies = ROW_COUNT;
  UPDATE public.tasks t SET done = true, completed_at = now(), notes = left(coalesce(t.notes || E'\n', '') || 'انلغت الدراسة: ' || why, 4000)
   WHERE t.company_id = c AND t.client_id = cl AND coalesce(t.done, false) = false AND t.title ~ '^\s*دراسة\s*سعر';
  GET DIAGNOSTICS n_tasks = ROW_COUNT;
  UPDATE public.owner_leads l SET status = 'closed', notes = left(coalesce(l.notes || E'\n', '') || 'ما نستلم: ' || why || ' (' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') || ')', 4000), updated_at = now()
   WHERE l.company_id = c AND l.conversation_id = p_conversation_id AND l.status = 'open';
  GET DIAGNOSTICS n_leads = ROW_COUNT;
  UPDATE public.whatsapp_conversations w SET human_handoff_required = false, handoff_reason = null, handoff_updated_at = now(), agent_returned_at = now(), updated_at = now()
   WHERE w.id = p_conversation_id AND w.company_id = c;
  RETURN jsonb_build_object('ok', true, 'tasks', n_tasks, 'offers', n_leads, 'studies', n_studies);
END $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_drop(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_study_drop(uuid, text) TO authenticated;
