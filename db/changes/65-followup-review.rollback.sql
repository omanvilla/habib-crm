-- Rollback for SQL65: restore crm_followups_today from db/changes/64-daily-followups-list.forward.sql first.
ALTER TABLE public.whatsapp_outreach_queue DROP COLUMN IF EXISTS auto_ok, DROP COLUMN IF EXISTS review_reason, DROP COLUMN IF EXISTS reviewed_at;
ALTER TABLE public.whatsapp_visit_followups DROP COLUMN IF EXISTS auto_ok, DROP COLUMN IF EXISTS review_reason, DROP COLUMN IF EXISTS reviewed_at;
