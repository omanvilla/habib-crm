-- Rollback for SQL42. Classifications already saved stay in property_inquiries /
-- client_requests (same rows the older one-property resolver creates); only the
-- queue, the classifier and the new columns are removed.
DROP FUNCTION IF EXISTS public.crm_classify_inquiry(uuid,text,uuid[],text,uuid[]);
DROP FUNCTION IF EXISTS public.crm_attention_queue(integer,integer);
DROP INDEX IF EXISTS public.unmatched_property_links_pending_conv_idx;
DROP INDEX IF EXISTS public.whatsapp_conversations_handoff_idx;
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_inquiry_classification_chk;
ALTER TABLE public.whatsapp_conversations
  DROP COLUMN IF EXISTS inquiry_classification, DROP COLUMN IF EXISTS inquiry_classification_note,
  DROP COLUMN IF EXISTS inquiry_classified_at, DROP COLUMN IF EXISTS inquiry_classified_by;
ALTER TABLE public.unmatched_property_links DROP CONSTRAINT IF EXISTS unmatched_property_links_resolution_kind_chk;
ALTER TABLE public.unmatched_property_links
  DROP COLUMN IF EXISTS resolution_kind, DROP COLUMN IF EXISTS resolution_note,
  DROP COLUMN IF EXISTS ai_suggestion, DROP COLUMN IF EXISTS ai_checked_at;
