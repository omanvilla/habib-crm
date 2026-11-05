-- Rollback for SQL64. Publish the front end without crm-followups-today.js first.
DROP TRIGGER IF EXISTS crm_followups_on_person_message ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.followups_on_person_message();
DROP FUNCTION IF EXISTS public.crm_followup_mark_sent(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.followups_sent_by_person(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.crm_followups_today();
DROP FUNCTION IF EXISTS public.crm_followup_auto_after(timestamptz);
UPDATE public.whatsapp_visit_followups SET send_mode = NULL WHERE send_mode = 'owner';
ALTER TABLE public.whatsapp_visit_followups DROP CONSTRAINT IF EXISTS whatsapp_visit_followups_send_mode_check;
ALTER TABLE public.whatsapp_visit_followups ADD CONSTRAINT whatsapp_visit_followups_send_mode_check CHECK (send_mode = ANY (ARRAY['service','template']));
ALTER TABLE public.whatsapp_outreach_queue DROP COLUMN IF EXISTS owner_text;
ALTER TABLE public.whatsapp_visit_followups DROP COLUMN IF EXISTS owner_text;
