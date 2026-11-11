-- Rollback of SQL93 (follow-up wording comparison, R36).
-- FIRST pin the functions back, because their SQL93 versions write variant_label:
--   whatsapp-visit-followup-auto -> 799141d, whatsapp-visit-templates -> 8cb9448
-- Then run this file. Waiting follow-ups on a test wording go back to today's wording (A) before anything is dropped,
-- so nothing reaches a customer in a wording that no longer exists. Results and the wordings themselves are lost.
-- Templates already created at Meta (fu_visit1_ar_… / fu_request_ar_…) stay there unused; their registry rows are removed.
SET LOCAL lock_timeout = '10s';

UPDATE public.whatsapp_visit_followups f
   SET body = public.crm_visit_followup_text(1, f.route_key), template_name = public.crm_visit_followup_template(1, f.route_key),
       owner_text = NULL, reviewed_at = NULL, updated_at = now()
 WHERE f.status = 'awaiting_approval' AND f.step = 1 AND f.variant_label IS NOT NULL AND f.variant_label <> 'A';
UPDATE public.whatsapp_outreach_queue q
   SET template_name = 'request_followup_ar_v2',
       messages = jsonb_build_array('بخصوص طلبك ' || coalesce(q.template_params ->> 0, ''), 'لين الحين تبحث ؟')
 WHERE q.status IN ('pending', 'approved') AND q.kind = 'request_followup' AND q.variant_label IS NOT NULL AND q.variant_label <> 'A';

DROP TRIGGER IF EXISTS variant_assign_visit_followup ON public.whatsapp_visit_followups;
DROP TRIGGER IF EXISTS variant_assign_request_followup ON public.whatsapp_outreach_queue;
DROP FUNCTION IF EXISTS public.crm_followup_variant_results();
DROP FUNCTION IF EXISTS public.crm_followup_variant_decide(uuid, text);
DROP FUNCTION IF EXISTS public.crm_followup_variant_save(text, text);
DROP FUNCTION IF EXISTS public.crm_followup_variants_settle();
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_assign_visit();
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_assign_request();
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_pick(uuid, text);
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_sent(uuid, text, text);
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_used(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS crm_repair_private.followup_variant_usable(uuid, text);
DELETE FROM public.whatsapp_template_registry t
 WHERE t.template_name IN (SELECT l.template_name FROM public.whatsapp_followup_variants l WHERE l.label <> 'A' AND l.template_name IS NOT NULL);
ALTER TABLE public.whatsapp_visit_followups DROP COLUMN IF EXISTS variant_label;
ALTER TABLE public.whatsapp_outreach_queue DROP COLUMN IF EXISTS variant_label;
DROP TABLE IF EXISTS public.whatsapp_followup_variants;
