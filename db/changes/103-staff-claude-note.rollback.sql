-- Rollback of SQL103: only the owner writes notes again, and the stamp goes. Notes already written stay (with their
-- by_staff / by_role / by_name) as history; a staff note that is still open stays a lesson until it is closed.
DROP TRIGGER IF EXISTS trg_owner_note_stamp ON public.crm_owner_notes;
DROP FUNCTION IF EXISTS crm_repair_private.owner_note_stamp();
DROP POLICY IF EXISTS "staff write notes" ON public.crm_owner_notes;
DROP POLICY IF EXISTS "owner writes notes" ON public.crm_owner_notes;
CREATE POLICY "owner writes notes" ON public.crm_owner_notes FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner'));
