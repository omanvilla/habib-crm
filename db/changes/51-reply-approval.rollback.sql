-- Rollback for SQL51. Drafts already decided keep their status text; new columns are dropped.
DROP TRIGGER IF EXISTS trg_supersede_reply_drafts ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS crm_repair_private.supersede_reply_drafts();
DROP FUNCTION IF EXISTS public.crm_reply_draft_reject(uuid, text);
DROP FUNCTION IF EXISTS public.crm_reply_rule_save(uuid, text, text, text, text, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.crm_reply_rule_delete(uuid);
DROP INDEX IF EXISTS public.whatsapp_reply_drafts_pending_idx;
UPDATE public.whatsapp_reply_drafts SET status = 'skipped' WHERE status IN ('superseded','sending');
ALTER TABLE public.whatsapp_reply_drafts DROP CONSTRAINT IF EXISTS whatsapp_reply_drafts_status_check;
ALTER TABLE public.whatsapp_reply_drafts ADD CONSTRAINT whatsapp_reply_drafts_status_check CHECK (status = ANY (ARRAY['pending','sent','approved','edited','rejected','skipped','failed']));
ALTER TABLE public.whatsapp_reply_drafts DROP COLUMN IF EXISTS approved_messages, DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS superseded_at;
ALTER TABLE public.whatsapp_reply_rules DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS intent, DROP COLUMN IF EXISTS property_id,
  DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_at;
