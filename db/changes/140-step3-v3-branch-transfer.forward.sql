-- SQL140 (18 Nov 2026, decisions 74 and 77 of Ahmed's review, docs/مراجعة-القرارات-20261118.md).
-- 1) Decision 74: Muscat's step-3 visit follow-up template v2 is MARKETING there. Ahmed approved v3
--    «السلام عليكم بخصوص زيارتك للعقار يوم {{1}} لين الحين تدور على عقار ؟» ({{1}} = the visit day, «15 أكتوبر»). Once Meta
--    approves it on Muscat as UTILITY, step 3 on Muscat takes it; until then (and on Barka) the old choice stays. The row's body
--    carries the day (trigger below), whatsapp-visit-followup-auto sends the day as the template variable.
-- 2) Decision 77 (step F): a client (buyer or owner) who writes to the wrong branch number about the other branch's area is
--    moved to the right number: the reply agent answers one line and calls crm_branch_transfer_queue; whatsapp-outreach (kind
--    branch_transfer) then sends from the right number the template branch_transfer_ar_v1 (only APPROVED + UTILITY) or the same
--    text inside an open 24h window, and closes what waits on the wrong number for that topic. The two company numbers never
--    message each other (checked here and in the send).
-- Nothing is sent and nothing existing is closed or deleted by this file. Rollback: 140-step3-v3-branch-transfer.rollback.sql
SET LOCAL lock_timeout = '10s';

-- «15 أكتوبر»
CREATE OR REPLACE FUNCTION crm_repair_private.ar_day_month(p_date date)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_date IS NULL THEN NULL ELSE extract(day FROM p_date)::int || ' ' ||
    (ARRAY['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month FROM p_date)::int] END
$function$;

CREATE OR REPLACE FUNCTION public.crm_visit_followup_template(p_step integer, p_route text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    -- SQL140 (decision 74): step 3 on Muscat takes v3 once Meta approved it there as UTILITY
    WHEN p_step = 3 AND p_route = 'muscat' AND EXISTS (SELECT 1 FROM public.whatsapp_template_registry t
      WHERE t.route_key = p_route AND t.template_name = 'visit_followup_3_ar_v3'
        AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY') THEN 'visit_followup_3_ar_v3'
    WHEN EXISTS (SELECT 1 FROM public.whatsapp_template_registry t
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
    -- SQL140: {{1}} becomes the visit day when the row is saved (crm_visit_followup_fill_day)
    WHEN public.crm_visit_followup_template(p_step, p_route) = 'visit_followup_3_ar_v3' THEN 'السلام عليكم بخصوص زيارتك للعقار يوم {{1}} لين الحين تدور على عقار ؟'
    WHEN p_step = 1 THEN 'السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟'
    WHEN p_step = 2 THEN 'بخصوص زيارتك الاخيرة للعقار هل عندك ملاحظة عليه ؟'
    WHEN p_step = 3 THEN 'بخصوص زيارتك الاخيرة للعقار هل وصلت لقرار ؟'
    WHEN p_step = 4 THEN 'نراجع طلبك المسجل عندنا هل طلبك لين الحين قائم ؟'
    ELSE public.crm_visit_followup_text(p_step) END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.visit_followup_fill_day()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_day text;
BEGIN
  IF NEW.body LIKE '%{{1}}%' THEN
    SELECT crm_repair_private.ar_day_month(vw.viewing_date) INTO v_day FROM public.viewings vw WHERE vw.id = NEW.viewing_id;
    NEW.body := CASE WHEN v_day IS NULL THEN replace(NEW.body, 'يوم {{1}} ', '') ELSE replace(NEW.body, '{{1}}', v_day) END;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.visit_followup_fill_day() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_visit_followup_fill_day ON public.whatsapp_visit_followups;
CREATE TRIGGER crm_visit_followup_fill_day BEFORE INSERT ON public.whatsapp_visit_followups
  FOR EACH ROW WHEN (NEW.body LIKE '%{{1}}%') EXECUTE FUNCTION crm_repair_private.visit_followup_fill_day();

-- ---- step F -------------------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_outreach_queue ADD COLUMN IF NOT EXISTS source_conversation_id uuid
  REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL;

-- Called by the reply agent (service role) on the wrong number. One transfer per client and branch in 30 days. The row is
-- approved (Ahmed approved the wording, decision 77) and sent by whatsapp-outreach send_approved, 9am to 9pm, only after the
-- agent's own line went out on the wrong number.
CREATE OR REPLACE FUNCTION public.crm_branch_transfer_queue(p_conversation uuid, p_to_route text, p_area text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  c record; cl record; v_to record; v_area text; v_branch text; v_text text; v_target uuid; v_id uuid; v_phone text;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversations WHERE id = p_conversation;
  IF c.id IS NULL OR c.client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_conversation'); END IF;
  IF c.route_key NOT IN ('muscat','barka') OR p_to_route NOT IN ('muscat','barka') OR p_to_route = c.route_key THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_route');
  END IF;
  SELECT * INTO cl FROM public.clients WHERE id = c.client_id;
  v_phone := regexp_replace(coalesce(cl.phone_normalized, cl.phone, ''), '\D', '', 'g');
  IF cl.id IS NULL OR coalesce(cl.archived, false) OR v_phone = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'client'); END IF;
  -- the two company numbers never message each other
  IF EXISTS (SELECT 1 FROM public.company_lead_routes r WHERE r.company_id = c.company_id
              AND regexp_replace(coalesce(r.whatsapp_number, ''), '\D', '', 'g') = v_phone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'company_number');
  END IF;
  SELECT * INTO v_to FROM public.company_lead_routes r WHERE r.company_id = c.company_id AND r.route_key = p_to_route AND r.is_active;
  IF v_to.route_key IS NULL OR v_to.meta_phone_number_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'route_not_ready'); END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_outreach_queue q WHERE q.client_id = c.client_id AND q.kind = 'branch_transfer'
              AND q.route_key = p_to_route AND q.status IN ('pending','approved','sent') AND q.created_at > now() - interval '30 days') THEN
    RETURN jsonb_build_object('ok', true, 'queued', false, 'reason', 'already');
  END IF;
  v_branch := CASE p_to_route WHEN 'muscat' THEN 'مسقط' ELSE 'بركاء' END;
  -- a short place name only (no punctuation, at most 40 characters); without one the branch's name
  v_area := left(btrim(regexp_replace(coalesce(p_area, ''), '[^ء-ي٠-٩A-Za-z0-9 ]', ' ', 'g')), 40);
  v_area := regexp_replace(v_area, '\s+', ' ', 'g');
  IF v_area = '' THEN v_area := v_branch; END IF;
  v_text := 'السلام عليكم بخصوص استفسارك عن عقار في ' || v_area || ' هذا رقم فرع ' || v_branch || ' المسؤول عن المنطقة تقدر تكمل معنا هنا';
  SELECT wc.id INTO v_target FROM public.whatsapp_conversations wc
   WHERE wc.company_id = c.company_id AND wc.meta_phone_number_id = v_to.meta_phone_number_id AND wc.customer_wa_id = v_phone LIMIT 1;
  INSERT INTO public.whatsapp_outreach_queue (company_id, kind, client_id, conversation_id, source_conversation_id, route_key, step, status,
      approved_at, template_name, template_params, messages, summary)
  VALUES (c.company_id, 'branch_transfer', c.client_id, v_target, c.id, p_to_route, 'branch_transfer', 'approved', now(),
      'branch_transfer_ar_v1', jsonb_build_array(v_area, v_branch), jsonb_build_array(v_text),
      'كلم رقم ' || CASE c.route_key WHEN 'muscat' THEN 'مسقط' ELSE 'بركاء' END || ' عن ' || v_area)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'queued', true, 'id', v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_branch_transfer_queue(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_branch_transfer_queue(uuid, text, text) TO service_role;

-- At send time: the client's chat on the right number (created like the webhook does when there is none yet). Returns the
-- conversation id, or null when the agent's line on the wrong number has not gone out (the row waits; after 24 hours it is
-- skipped as source_reply_not_sent) or the row is not a branch transfer waiting to go.
CREATE OR REPLACE FUNCTION public.crm_branch_transfer_target(p_queue uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE q record; cl record; v_to record; v_phone text; v_id uuid;
BEGIN
  SELECT * INTO q FROM public.whatsapp_outreach_queue WHERE id = p_queue AND kind = 'branch_transfer' AND status = 'approved';
  IF q.id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = q.source_conversation_id
                  AND m.direction = 'outbound' AND m.message_timestamp >= q.created_at - interval '1 minute') THEN
    IF q.created_at < now() - interval '24 hours' THEN
      UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'source_reply_not_sent' WHERE id = q.id;
    END IF;
    RETURN NULL;
  END IF;
  IF q.conversation_id IS NOT NULL THEN RETURN q.conversation_id; END IF;
  SELECT * INTO cl FROM public.clients WHERE id = q.client_id;
  v_phone := regexp_replace(coalesce(cl.phone_normalized, cl.phone, ''), '\D', '', 'g');
  SELECT * INTO v_to FROM public.company_lead_routes r WHERE r.company_id = q.company_id AND r.route_key = q.route_key AND r.is_active;
  IF v_phone = '' OR v_to.meta_phone_number_id IS NULL THEN RETURN NULL; END IF;
  SELECT wc.id INTO v_id FROM public.whatsapp_conversations wc
   WHERE wc.company_id = q.company_id AND wc.meta_phone_number_id = v_to.meta_phone_number_id AND wc.customer_wa_id = v_phone;
  IF v_id IS NULL THEN
    INSERT INTO public.whatsapp_conversations (company_id, client_id, route_key, assigned_to, meta_phone_number_id, inbound_number,
        customer_wa_id, customer_phone, customer_name, status, unread_count)
    VALUES (q.company_id, q.client_id, q.route_key, v_to.assigned_to, v_to.meta_phone_number_id, v_to.whatsapp_number,
        v_phone, '+' || v_phone, cl.name, 'open', 0)
    ON CONFLICT (company_id, meta_phone_number_id, customer_wa_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT wc.id INTO v_id FROM public.whatsapp_conversations wc
       WHERE wc.company_id = q.company_id AND wc.meta_phone_number_id = v_to.meta_phone_number_id AND wc.customer_wa_id = v_phone;
    END IF;
  END IF;
  UPDATE public.whatsapp_outreach_queue SET conversation_id = v_id WHERE id = q.id;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_branch_transfer_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_branch_transfer_target(uuid) TO service_role;

-- After it went: what still waits on the wrong number for this topic is closed, as close_other_branch does in the reply agent
-- (pending reply drafts superseded, pending office messages skipped), only what was there before the transfer; a newer
-- topic of the client on that number stays. Sent messages and the chat itself are not touched.
CREATE OR REPLACE FUNCTION public.crm_branch_transfer_close_source(p_queue uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE q record; v_d int; v_o int;
BEGIN
  SELECT * INTO q FROM public.whatsapp_outreach_queue WHERE id = p_queue AND kind = 'branch_transfer' AND status = 'sent';
  IF q.id IS NULL OR q.source_conversation_id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  UPDATE public.whatsapp_reply_drafts SET status = 'superseded', superseded_at = now(), approver_note = 'العميل انتقل لرقم فرعه'
   WHERE conversation_id = q.source_conversation_id AND status = 'pending' AND created_at <= q.created_at;
  GET DIAGNOSTICS v_d = ROW_COUNT;
  UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'branch_transfer'
   WHERE conversation_id = q.source_conversation_id AND status = 'pending' AND created_at <= q.created_at;
  GET DIAGNOSTICS v_o = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'drafts', v_d, 'outreach', v_o);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_branch_transfer_close_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_branch_transfer_close_source(uuid) TO service_role;
