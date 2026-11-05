-- SQL67 (5 Nov 2026): a client the review removed stays off the list until the client writes again.
-- The request follow-up generator works per request, and a client can have more than one, so a removed client came back
-- within the hour through another request, and would have come back after a week through the daily seed.
-- Follow-ups with a reason (the owner's own decisions) are not affected.
CREATE OR REPLACE FUNCTION public.crm_queue_keep_review_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_last_in timestamptz;
BEGIN
  IF NEW.kind <> 'request_followup' OR NEW.reason IS NOT NULL THEN RETURN NEW; END IF;
  SELECT max(w.last_inbound_at) INTO v_last_in FROM public.whatsapp_conversations w WHERE w.client_id = NEW.client_id;
  IF EXISTS (SELECT 1 FROM public.whatsapp_outreach_queue q
              WHERE q.client_id = NEW.client_id AND q.status = 'skipped' AND q.reason LIKE 'review\_%'
                AND q.reviewed_at > coalesce(v_last_in, '-infinity'))
     OR EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f
              WHERE f.client_id = NEW.client_id AND f.status = 'stopped' AND f.error LIKE 'review\_%'
                AND f.reviewed_at > coalesce(v_last_in, '-infinity')) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_queue_keep_review_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS keep_review_decision ON public.whatsapp_outreach_queue;
CREATE TRIGGER keep_review_decision BEFORE INSERT ON public.whatsapp_outreach_queue
  FOR EACH ROW EXECUTE FUNCTION public.crm_queue_keep_review_decision();
