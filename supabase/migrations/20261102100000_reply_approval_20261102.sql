-- SQL51: owner approval of WhatsApp reply drafts.
-- * A pending draft is superseded when the customer writes again (the agent drafts a fresh
--   reply for the newest message) or when a person from the office replies.
-- * The owner can reject a draft or pin a reply as a rule from the CRM. Approve-and-send runs in
--   the whatsapp-reply-send Edge Function (it needs the WhatsApp token) and checks the owner too.
ALTER TABLE public.whatsapp_reply_drafts
  ADD COLUMN IF NOT EXISTS approved_messages text[],
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE public.whatsapp_reply_drafts DROP CONSTRAINT IF EXISTS whatsapp_reply_drafts_status_check;
ALTER TABLE public.whatsapp_reply_drafts ADD CONSTRAINT whatsapp_reply_drafts_status_check
  CHECK (status = ANY (ARRAY['pending','sending','sent','approved','edited','rejected','skipped','failed','superseded']));
CREATE INDEX IF NOT EXISTS whatsapp_reply_drafts_pending_idx ON public.whatsapp_reply_drafts(company_id, created_at DESC) WHERE status = 'pending';

ALTER TABLE public.whatsapp_reply_rules
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION crm_repair_private.supersede_reply_drafts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.direction = 'inbound' OR (NEW.direction = 'outbound' AND NEW.actor_type = 'human') THEN
    -- Never let draft housekeeping block an incoming or outgoing message from being saved.
    BEGIN
      UPDATE public.whatsapp_reply_drafts d
         SET status = 'superseded', superseded_at = now()
       WHERE d.conversation_id = NEW.conversation_id AND d.status = 'pending'
         AND d.message_id IS DISTINCT FROM NEW.id
         AND coalesce(d.analysis->>'dry_run', '') <> 'true';
    EXCEPTION WHEN others THEN
      RAISE WARNING 'supersede_reply_drafts: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.supersede_reply_drafts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_supersede_reply_drafts ON public.whatsapp_messages;
CREATE TRIGGER trg_supersede_reply_drafts AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.supersede_reply_drafts();

-- Owner rejects a pending draft (nothing is sent).
CREATE OR REPLACE FUNCTION public.crm_reply_draft_reject(p_draft_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_reply_drafts SET status = 'rejected', decided_at = now(), decided_by = auth.uid(),
         approver_note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_draft_id AND company_id = v_company AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_pending' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Owner pins a reply as a rule for similar situations (used by the agent from the next draft).
CREATE OR REPLACE FUNCTION public.crm_reply_rule_save(p_rule_id uuid, p_situation text, p_reply text,
  p_category text DEFAULT NULL, p_intent text DEFAULT NULL, p_property_id uuid DEFAULT NULL,
  p_source_draft_id uuid DEFAULT NULL, p_active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_id uuid;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_situation, ''))) < 3 OR length(btrim(coalesce(p_reply, ''))) < 1 THEN
    RAISE EXCEPTION 'situation_and_reply_required' USING ERRCODE = '22023'; END IF;
  IF p_rule_id IS NULL THEN
    INSERT INTO public.whatsapp_reply_rules(company_id, situation, approved_reply, category, intent, property_id, source_draft_id, active, created_by)
    VALUES (v_company, btrim(p_situation), btrim(p_reply), p_category, p_intent, p_property_id, p_source_draft_id, coalesce(p_active, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.whatsapp_reply_rules SET situation = btrim(p_situation), approved_reply = btrim(p_reply), category = p_category,
           intent = p_intent, property_id = p_property_id, active = coalesce(p_active, true), updated_at = now()
     WHERE id = p_rule_id AND company_id = v_company RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'rule_not_found' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'rule_id', v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_reply_rule_delete(p_rule_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.whatsapp_reply_rules WHERE id = p_rule_id AND company_id = public.my_company();
  IF NOT FOUND THEN RAISE EXCEPTION 'rule_not_found' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.crm_reply_draft_reject(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_reply_rule_save(uuid, text, text, text, text, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_reply_rule_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_reply_draft_reject(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reply_rule_save(uuid, text, text, text, text, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reply_rule_delete(uuid) TO authenticated;
