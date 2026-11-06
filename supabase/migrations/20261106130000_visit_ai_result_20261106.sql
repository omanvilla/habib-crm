-- SQL73 (6 Nov 2026, owner's decision): the AI records visit results from the chat, so «زيارات تحتاج نتيجة» is not his job.
-- whatsapp-visit-followup-auto reads the chat of each past visit with no result when the client has written since the
-- last check, and saves done / no_show / postponed / cancelled with the client's opinion through the normal visit columns
-- (sync_viewing_to_crm moves the deal as for a manual result). ai_checked_at stops the same chat being read twice.
ALTER TABLE public.viewings ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
