-- SQL50: WhatsApp reply drafts and pinned replies are owner-only.
-- Before: any company account could read every draft (Muscat, Barka and owner-only investment
-- conversations), and the authenticated role held INSERT/UPDATE/DELETE/TRUNCATE on both tables.
-- Writes come only from the reply agent (service role) and, later, owner RPCs.
DROP POLICY IF EXISTS reply_drafts_company_read ON public.whatsapp_reply_drafts;
DROP POLICY IF EXISTS reply_rules_company_read ON public.whatsapp_reply_rules;
CREATE POLICY reply_drafts_owner_read ON public.whatsapp_reply_drafts FOR SELECT TO authenticated
 USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
CREATE POLICY reply_rules_owner_read ON public.whatsapp_reply_rules FOR SELECT TO authenticated
 USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_reply_drafts FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_reply_rules FROM authenticated, anon;
REVOKE ALL ON public.whatsapp_reply_drafts, public.whatsapp_reply_rules FROM anon;
