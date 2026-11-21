-- Rollback of SQL150. A study left in kept_internal goes back to approved (held), so nothing is lost and nothing is sent.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_price_study_mark_outreach ON public.owner_price_studies;
DROP FUNCTION IF EXISTS crm_repair_private.price_study_mark_outreach();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_office_outreach(uuid);
UPDATE public.owner_price_studies SET status = 'approved', send_error = 'held_by_ahmed_new_flow', updated_at = now() WHERE status = 'kept_internal';
ALTER TABLE public.owner_price_studies DROP CONSTRAINT IF EXISTS owner_price_studies_status_check;
ALTER TABLE public.owner_price_studies ADD CONSTRAINT owner_price_studies_status_check CHECK (status = ANY (ARRAY[
  'submitted', 'files_failed', 'awaiting_approval', 'rejected', 'approved', 'sending', 'waiting_owner', 'sent', 'send_failed', 'cancelled']));
-- crm_price_studies_pending: re-run its body from supabase/migrations/20261119090000_price_study_phone_send_20261119.sql (SQL146).
-- The office_outreach and owner_price columns stay (harmless, nothing reads them after the rollback).
