-- Rollback of SQL171: the SQL158 owner documents reminder (offers with no grade only).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.owner_docs_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record; v_text text := 'ننتظر منك الكروكي والملكية عشان نبدأ دراسة السعر اذا ما عليك امر'; n integer := 0;
BEGIN
  UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'template_not_approved'
   WHERE kind = 'owner_docs' AND status = 'approved' AND created_at < now() - interval '7 days';
  FOR r IN
    SELECT DISTINCT ON (c.id) l.id AS lead_id, l.company_id, c.id AS conv_id, c.client_id, c.route_key, c.last_inbound_at,
           (SELECT max(m.message_timestamp) FROM public.whatsapp_messages m
             WHERE m.conversation_id = c.id AND m.direction = 'outbound'
               AND coalesce(m.body, '') ~ '(الكروكي|الملكية|الملكيات|المستندات)') AS ask_at,
           (SELECT max(q.sent_at) FROM public.whatsapp_outreach_queue q WHERE q.conversation_id = c.id AND q.kind = 'owner_docs' AND q.status = 'sent') AS last_sent,
           (SELECT count(*) FROM public.whatsapp_outreach_queue q WHERE q.conversation_id = c.id AND q.kind = 'owner_docs' AND q.status = 'sent') AS sent_n
      FROM public.owner_leads l
      JOIN public.whatsapp_conversations c ON c.id = l.conversation_id
      JOIN public.clients cl ON cl.id = c.client_id
     WHERE l.status = 'open' AND l.doc_grade IS NULL AND l.created_at > now() - interval '21 days'
       AND l.source_request_id IS NULL
       AND c.route_key IN ('barka', 'muscat') AND NOT coalesce(c.agent_muted, false) AND NOT coalesce(c.human_handoff_required, false)
       AND c.ignored_at IS NULL AND NOT coalesce(cl.followup_suppressed, false) AND NOT coalesce(cl.archived, false)
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_outreach_queue q WHERE q.client_id = c.client_id AND q.status IN ('pending', 'approved') AND NOT coalesce(q.dry_run, false))
     ORDER BY c.id, l.created_at DESC
  LOOP
    CONTINUE WHEN r.ask_at IS NULL OR coalesce(r.last_inbound_at, '-infinity') > r.ask_at;
    CONTINUE WHEN public.crm_chat_hold(r.conv_id) IS NOT NULL;
    IF r.sent_n = 0 AND r.ask_at < now() - interval '20 hours' THEN
      NULL;
    ELSIF r.sent_n = 1 AND r.last_sent < now() - interval '3 days' AND coalesce(r.last_inbound_at, '-infinity') < r.last_sent THEN
      NULL;
    ELSE
      CONTINUE;
    END IF;
    INSERT INTO public.whatsapp_outreach_queue (company_id, kind, client_id, conversation_id, route_key, step, status, approved_at, scheduled_for,
                                                template_name, template_params, messages, summary, auto_ok, dry_run, reason)
    VALUES (r.company_id, 'owner_docs', r.client_id, r.conv_id, r.route_key, 'owner_docs_' || (r.sent_n + 1)::text, 'approved', now(), now(),
            'owner_docs_reminder_ar_v1', '[]'::jsonb, jsonb_build_array(v_text), 'متابعة مالك: ما أرسل الكروكي والمستندات (R119)', true, false,
            'owner_lead:' || r.lead_id::text);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
