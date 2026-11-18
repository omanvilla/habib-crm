-- Rollback SQL133: a sold notice goes by itself only inside the 24-hour window again (SQL132 body).
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION crm_repair_private.outreach_auto_sold_notice()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.whatsapp_outreach_queue q
     SET status = 'approved', approved_at = now(), scheduled_for = least(coalesce(q.scheduled_for, now()), now()), reason = 'auto_sold_notice'
    FROM public.whatsapp_conversations w
   WHERE w.id = q.conversation_id
     AND q.kind = 'property_sold' AND q.status = 'pending' AND NOT coalesce(q.dry_run, false)
     AND q.reviewed_at IS NOT NULL
     AND q.created_at >= timestamptz '2026-11-18 09:30:00+04'
     AND w.last_inbound_at > now() - interval '23 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
