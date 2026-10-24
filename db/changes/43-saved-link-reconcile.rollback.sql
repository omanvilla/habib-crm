-- Rollback for SQL43: remove the guards and the automatic reconciliation.
-- Inquiries/requests created by the catch-up are ordinary linked inquiries and
-- stay. To put the review rows and hand-offs back exactly as they were, run the
-- two optional statements below before dropping the backup tables.
DROP TRIGGER IF EXISTS crm_reconcile_on_saved_link ON public.property_marketing_events;
DROP TRIGGER IF EXISTS crm_suppress_empty_identify_handoff ON public.whatsapp_conversations;
DROP TRIGGER IF EXISTS crm_skip_attributed_text_review ON public.unmatched_property_links;
DROP FUNCTION IF EXISTS crm_repair_private.reconcile_on_saved_link();
DROP FUNCTION IF EXISTS crm_repair_private.suppress_empty_identify_handoff();
DROP FUNCTION IF EXISTS crm_repair_private.skip_attributed_text_review();
DROP FUNCTION IF EXISTS crm_repair_private.resolve_saved_link_reviews(uuid,text);
DROP FUNCTION IF EXISTS crm_repair_private.clear_identify_handoffs(uuid,uuid[]);

-- Optional exact restore of the queue state:
-- UPDATE public.unmatched_property_links u SET status='pending',resolution_kind=NULL,resolution_note=NULL,property_id=NULL,
--   marketing_event_id=NULL,resolved_at=NULL,updated_at=now() FROM crm_repair_private.sql43_auto_resolved a WHERE a.unmatched_id=u.id;
-- UPDATE public.whatsapp_conversations w SET human_handoff_required=true,handoff_reason=h.handoff_reason,handoff_updated_at=h.handoff_updated_at
--   FROM crm_repair_private.sql43_cleared_handoffs h WHERE h.conversation_id=w.id;
-- DROP TABLE crm_repair_private.sql43_auto_resolved, crm_repair_private.sql43_cleared_handoffs;
