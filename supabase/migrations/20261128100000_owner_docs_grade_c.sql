-- SQL171 (28 Nov 2026, Ahmed «نعم للكل»): the owner documents reminder (R119, SQL155/158) also reaches an owner whose offer
-- was graded C by the cloud pricing (ownership / kroki missing) and who sent nothing since the grade. Before, the reminder
-- covered only offers with no grade yet, so a C owner was never asked again and the study waited for ever (SQL170
-- waiting_docs). Same text, same two steps (20 hours after our last ask, then once more 3 days later), same hours and holds.
-- For a C offer the owner's silence counts from the later of our ask and the grade.
-- Left out: offers whose grade note says the owner wants to rent (تأجير / ايجار), where a sale price study makes no sense.
-- Rollback: 171-owner-docs-grade-c.rollback.sql (the SQL158 function).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.owner_docs_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record; v_ref timestamptz; v_text text := 'ننتظر منك الكروكي والملكية عشان نبدأ دراسة السعر اذا ما عليك امر'; n integer := 0;
BEGIN
  UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'template_not_approved'
   WHERE kind = 'owner_docs' AND status = 'approved' AND created_at < now() - interval '7 days';
  FOR r IN
    SELECT DISTINCT ON (c.id) l.id AS lead_id, l.company_id, l.doc_grade, l.doc_graded_at, c.id AS conv_id, c.client_id, c.route_key, c.last_inbound_at,
           (SELECT max(m.message_timestamp) FROM public.whatsapp_messages m
             WHERE m.conversation_id = c.id AND m.direction = 'outbound'
               AND coalesce(m.body, '') ~ '(الكروكي|الملكية|الملكيات|المستندات)') AS ask_at,
           (SELECT max(q.sent_at) FROM public.whatsapp_outreach_queue q WHERE q.conversation_id = c.id AND q.kind = 'owner_docs' AND q.status = 'sent') AS last_sent,
           (SELECT count(*) FROM public.whatsapp_outreach_queue q WHERE q.conversation_id = c.id AND q.kind = 'owner_docs' AND q.status = 'sent') AS sent_n
      FROM public.owner_leads l
      JOIN public.whatsapp_conversations c ON c.id = l.conversation_id
      JOIN public.clients cl ON cl.id = c.client_id
     WHERE l.status = 'open' AND l.created_at > now() - interval '21 days'
       -- SQL171: no grade yet, or graded C with nothing sent after the grade (and not a rental)
       AND (l.doc_grade IS NULL
            OR (l.doc_grade = 'C' AND l.doc_graded_at IS NOT NULL
                AND coalesce(l.doc_grade_note, '') !~ '(تأجير|ايجار|إيجار)'
                AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m2
                                 WHERE m2.conversation_id = c.id AND m2.direction = 'inbound'
                                   AND m2.message_type IN ('image', 'document', 'video')
                                   AND m2.message_timestamp > l.doc_graded_at)))
       AND l.source_request_id IS NULL
       AND c.route_key IN ('barka', 'muscat') AND NOT coalesce(c.agent_muted, false) AND NOT coalesce(c.human_handoff_required, false)
       AND c.ignored_at IS NULL AND NOT coalesce(cl.followup_suppressed, false) AND NOT coalesce(cl.archived, false)
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_outreach_queue q WHERE q.client_id = c.client_id AND q.status IN ('pending', 'approved') AND NOT coalesce(q.dry_run, false))
     ORDER BY c.id, l.created_at DESC
  LOOP
    -- SQL171: for a C offer the grade is the newest «still missing», so the owner's silence counts from the later of our ask
    -- and the grade (he may have written after our ask, before we graded what he sent)
    v_ref := CASE WHEN r.doc_grade = 'C' THEN greatest(coalesce(r.ask_at, '-infinity'), r.doc_graded_at) ELSE r.ask_at END;
    CONTINUE WHEN v_ref IS NULL OR coalesce(r.last_inbound_at, '-infinity') > v_ref;
    CONTINUE WHEN public.crm_chat_hold(r.conv_id) IS NOT NULL;
    IF r.sent_n = 0 AND v_ref < now() - interval '20 hours' THEN
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
