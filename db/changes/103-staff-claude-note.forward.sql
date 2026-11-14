-- SQL103 (14 Nov 2026, Ahmed, R58: «الموظفين أريدهم نفس الشيء، يكون عندهم نفس الزر مالي… ضيفه في كل مكان عندهم»):
--   staff (manager, agent) may save «ملاحظة لـ Claude», and every note says who wrote it.
--   Until now only the owner could insert into crm_owner_notes, so a staff note was refused by the database.
--   1. Policy «staff write notes» replaces «owner writes notes»: an active owner, manager or agent of the company may insert
--      a note under his own id, on no chat or on a chat his account may see (the chat is read under his own row rules, so
--      the owner's private line and the investment chats stay out of reach of staff).
--   2. Trigger trg_owner_note_stamp (before insert): the writer is the signed-in account whatever the browser sends, and
--      context gets by_staff, by_role and by_name from his profile. A note written by a function (no signed-in account,
--      as «أمر للذكاء الاصطناعي» of R28) keeps the by_staff it carries and gets by_role / by_name from created_by.
--   Reading the notes stays the owner's. A staff note is a lesson at once like the owner's (Ahmed: «على طول مثل R28»): the
--   lessons trigger (trg_rebuild_agent_lessons) is not touched, so the brain text does not change with this file.
-- Only adds one policy (in place of the old one), one function and one trigger. No table, no column, no row is changed.

DROP POLICY IF EXISTS "owner writes notes" ON public.crm_owner_notes;
DROP POLICY IF EXISTS "staff write notes" ON public.crm_owner_notes;
CREATE POLICY "staff write notes" ON public.crm_owner_notes FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND company_id IN (
      SELECT p.company_id FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role IN ('owner', 'manager', 'agent') AND p.is_active IS NOT FALSE)
    AND (conversation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.whatsapp_conversations w
       WHERE w.id = crm_owner_notes.conversation_id AND w.company_id = crm_owner_notes.company_id))
  );

CREATE OR REPLACE FUNCTION crm_repair_private.owner_note_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_role text;
  v_name text;
BEGIN
  IF me IS NOT NULL THEN NEW.created_by := me; END IF;
  SELECT p.role, p.full_name INTO v_role, v_name FROM public.profiles p WHERE p.id = NEW.created_by;
  NEW.context := COALESCE(NEW.context, '{}'::jsonb);
  IF me IS NOT NULL OR NOT (NEW.context ? 'by_staff') THEN
    NEW.context := NEW.context || jsonb_build_object('by_staff', COALESCE(v_role, '') <> 'owner');
  END IF;
  NEW.context := NEW.context || jsonb_build_object('by_role', v_role, 'by_name', v_name);
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.owner_note_stamp() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_owner_note_stamp ON public.crm_owner_notes;
CREATE TRIGGER trg_owner_note_stamp BEFORE INSERT ON public.crm_owner_notes
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.owner_note_stamp();
