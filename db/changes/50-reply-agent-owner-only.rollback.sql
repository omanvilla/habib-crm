-- Rollback for SQL50: restore the previous company-wide read policies and grants.
DROP POLICY IF EXISTS reply_drafts_owner_read ON public.whatsapp_reply_drafts;
DROP POLICY IF EXISTS reply_rules_owner_read ON public.whatsapp_reply_rules;
CREATE POLICY reply_drafts_company_read ON public.whatsapp_reply_drafts FOR SELECT
 USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.company_id = whatsapp_reply_drafts.company_id));
CREATE POLICY reply_rules_company_read ON public.whatsapp_reply_rules FOR SELECT
 USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.company_id = whatsapp_reply_rules.company_id));
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_reply_drafts, public.whatsapp_reply_rules TO authenticated;
