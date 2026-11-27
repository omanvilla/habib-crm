-- SQL159 (27 Nov 2026, thread «قلّل تحويلات العقل لأحمد بحفظ أجوبته»).
-- The reply agent hands Ahmed every question whose answer is not written (R41, «سؤال ما عندي جوابه:»): about 3 a day,
-- and the same ones come back (units of the Sohman villa under construction, the zero-down offer for expats, what the
-- Sultan Qaboos City flat includes, is the Rumais villa new, ...). Now Ahmed's answer is kept and the agent reuses it:
--   * agent_saved_answers: one question and Ahmed's answer, tied to a property (property_id) or general (property_id null).
--     status pending (caught from the chat, waits for Ahmed's tap), active (the agent uses it), paused, dismissed.
--   * crm_saved_answer_capture (trigger on whatsapp_messages): when the office writes by hand (outbound, actor human, text)
--     in a chat whose open handoff is «سؤال ما عندي جوابه:» (set in the last 7 days), the message is added to one pending
--     row for that handoff, with the question (the handoff text) and the property the agent had in mind (its draft).
--     Greetings, «لحظات», «تفضل» and the property ad itself are left out.
--   * crm_saved_answer_decide (owner only): save (scope property / general, the question and answer can be edited),
--     dismiss, pause, resume. Nothing is ever deleted.
--   * Reading is owner only (same as the pinned replies, SQL50). The agent reads with the service role.
--   * Backfill: the R41 handoffs of 12 to 26 Nov that got a hand-written answer become pending rows for Ahmed to tap.
-- Rollback: 159-saved-answers.rollback.sql

CREATE TABLE IF NOT EXISTS public.agent_saved_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  property_id uuid REFERENCES public.properties(id),
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'dismissed')),
  source_conversation_id uuid REFERENCES public.whatsapp_conversations(id),
  source_message_ids uuid[] NOT NULL DEFAULT '{}',
  handoff_at timestamptz,
  answered_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_saved_answers_one_pending ON public.agent_saved_answers (source_conversation_id, handoff_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_saved_answers_active ON public.agent_saved_answers (company_id, property_id) WHERE status = 'active';

ALTER TABLE public.agent_saved_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_saved_answers FROM anon, authenticated;
GRANT SELECT ON public.agent_saved_answers TO authenticated;
DROP POLICY IF EXISTS saved_answers_owner_read ON public.agent_saved_answers;
CREATE POLICY saved_answers_owner_read ON public.agent_saved_answers FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');

-- a hand-written line that answers nothing (greeting, «لحظات», «تفضل», the ad)
CREATE OR REPLACE FUNCTION crm_repair_private.saved_answer_noise(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(btrim(p), '') = ''
    OR length(btrim(p)) < 2
    OR btrim(p) ~ '^\s*🏡'
    OR btrim(regexp_replace(p, '[[:punct:]؟،!.\s👍🙏🌹❤️]+', ' ', 'g')) ~* '^(السلام عليكم( ورحمة الله( وبركاته)?)?|وعليكم السلام( ورحمة الله( وبركاته)?)?|مساء (النور|الخير)|صباح (النور|الخير)|هلا( والله)?|اهلا( وسهلا)?|أهلا( وسهلا)?|لحظات?|لحظة من فضلك|تفضل|تفضلي|العفو|تمام|ok|okay|كيف الحال|السلام عليكم (اخي|اخ \S+)? ?كيف الحال|ممكن التفاصيل|اي فيلا تقصد|اي عقار تقصد|)$'
$f$;

CREATE OR REPLACE FUNCTION crm_repair_private.saved_answer_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c record; v_pid uuid; v_q text; v_body text;
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.actor_type IS DISTINCT FROM 'human' OR NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  v_body := btrim(coalesce(NEW.body, ''));
  IF crm_repair_private.saved_answer_noise(v_body) THEN RETURN NEW; END IF;
  SELECT id, company_id, handoff_reason, handoff_updated_at INTO c FROM public.whatsapp_conversations
   WHERE id = NEW.conversation_id AND human_handoff_required AND handoff_reason ~ '^\s*سؤال ما عندي جوابه\s*:'
     AND handoff_updated_at > now() - interval '7 days';
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_q := btrim(regexp_replace(c.handoff_reason, '^\s*سؤال ما عندي جوابه\s*:\s*', ''));
  SELECT p.id INTO v_pid FROM public.whatsapp_reply_drafts d JOIN public.properties p ON p.company_id = c.company_id
      AND p.id::text = d.analysis->>'property_id'
   WHERE d.conversation_id = c.id AND d.analysis->>'handoff_reason' ~ '^\s*سؤال ما عندي جوابه'
   ORDER BY d.created_at DESC LIMIT 1;
  INSERT INTO public.agent_saved_answers (company_id, property_id, question, answer, source_conversation_id, source_message_ids, handoff_at, answered_by)
  VALUES (c.company_id, v_pid, left(v_q, 400), left(v_body, 1500), c.id, ARRAY[NEW.id], c.handoff_updated_at, NEW.sent_by_user_id)
  ON CONFLICT (source_conversation_id, handoff_at) WHERE status = 'pending'
  DO UPDATE SET answer = left(agent_saved_answers.answer || E'\n' || EXCLUDED.answer, 1500),
     source_message_ids = agent_saved_answers.source_message_ids || EXCLUDED.source_message_ids, updated_at = now()
   WHERE NOT (NEW.id = ANY (agent_saved_answers.source_message_ids));
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;  -- never block a message
END $f$;

-- named crm_a… so it runs before trg_clear_handoff_on_human_reply (AFTER triggers fire by name)
DROP TRIGGER IF EXISTS crm_a_saved_answer_capture ON public.whatsapp_messages;
CREATE TRIGGER crm_a_saved_answer_capture AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
  WHEN (NEW.direction = 'outbound' AND NEW.actor_type = 'human') EXECUTE FUNCTION crm_repair_private.saved_answer_capture();

CREATE OR REPLACE FUNCTION public.crm_saved_answer_decide(p_id uuid, p_action text, p_scope text DEFAULT NULL, p_question text DEFAULT NULL, p_answer text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r public.agent_saved_answers; v_status text;
BEGIN
  IF (SELECT public.my_role()) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'; END IF;
  SELECT * INTO r FROM public.agent_saved_answers WHERE id = p_id AND company_id = (SELECT public.my_company()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_status := CASE p_action WHEN 'save' THEN 'active' WHEN 'resume' THEN 'active' WHEN 'pause' THEN 'paused' WHEN 'dismiss' THEN 'dismissed' END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'bad_action'; END IF;
  IF p_action = 'save' AND btrim(coalesce(p_answer, r.answer)) = '' THEN RAISE EXCEPTION 'empty_answer'; END IF;
  IF p_action = 'save' AND p_scope = 'property' AND r.property_id IS NULL THEN RAISE EXCEPTION 'no_property'; END IF;
  UPDATE public.agent_saved_answers SET status = v_status,
    property_id = CASE WHEN p_action = 'save' AND p_scope = 'general' THEN NULL ELSE property_id END,
    question = CASE WHEN p_action = 'save' AND btrim(coalesce(p_question, '')) <> '' THEN left(btrim(p_question), 400) ELSE question END,
    answer = CASE WHEN p_action = 'save' AND btrim(coalesce(p_answer, '')) <> '' THEN left(btrim(p_answer), 1500) ELSE answer END,
    decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END $f$;
REVOKE ALL ON FUNCTION public.crm_saved_answer_decide(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_saved_answer_decide(uuid, text, text, text, text) TO authenticated;

-- backfill: R41 handoffs since 12 Nov answered by hand (up to the next inbound-led handoff of the same chat, 3 days max)
INSERT INTO public.agent_saved_answers (company_id, property_id, question, answer, source_conversation_id, source_message_ids, handoff_at, answered_by, created_at)
SELECT d.company_id, p.id, left(btrim(regexp_replace(d.analysis->>'handoff_reason', '^\s*سؤال ما عندي جوابه\s*:\s*', '')), 400),
       left(string_agg(btrim(m.body), E'\n' ORDER BY m.message_timestamp), 1500), d.conversation_id, array_agg(m.id ORDER BY m.message_timestamp),
       d.created_at, (array_agg(m.sent_by_user_id ORDER BY m.message_timestamp))[1], d.created_at
FROM public.whatsapp_reply_drafts d
LEFT JOIN public.properties p ON p.company_id = d.company_id AND p.id::text = d.analysis->>'property_id'
JOIN public.whatsapp_messages m ON m.conversation_id = d.conversation_id AND m.direction = 'outbound' AND m.actor_type = 'human'
  AND m.message_timestamp > d.created_at AND m.message_timestamp < d.created_at + interval '3 days'
  AND NOT crm_repair_private.saved_answer_noise(m.body)
  AND NOT EXISTS (SELECT 1 FROM public.whatsapp_reply_drafts d2 WHERE d2.conversation_id = d.conversation_id AND d2.created_at > d.created_at
                  AND d2.created_at < m.message_timestamp AND d2.analysis->>'handoff_reason' ~ '^\s*سؤال ما عندي جوابه')
WHERE d.analysis->>'handoff_reason' ~ '^\s*سؤال ما عندي جوابه' AND d.created_at >= '2026-11-12'
  AND NOT EXISTS (SELECT 1 FROM public.agent_saved_answers a WHERE a.source_conversation_id = d.conversation_id AND a.handoff_at = d.created_at)
GROUP BY d.id, d.company_id, p.id, d.analysis, d.conversation_id, d.created_at;
