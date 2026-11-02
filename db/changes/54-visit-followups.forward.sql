-- SQL54: follow-up after a visit, approved by the owner before anything is sent.
-- Schedule: 1, 3, 7 and 30 days after the anchor. The anchor is the visit, or the last time a
-- person from the office wrote to the customer (staff contact restarts the clock). Text steps
-- advance across restarts (4 messages at most per visit). Stops for good when the customer says
-- they do not want it, or after 3 follow-ups in a row without an answer; the visit's request is
-- then added to whatsapp_followup_optouts. Nothing is queued while the customer is mid-chat
-- (wrote in the last 48h), while the conversation waits for staff (handoff), or outside 9:00-21:00
-- Muscat. Queued rows wait in "ردود تنتظر موافقتك"; whatsapp-reply-send sends them on approval.
CREATE TABLE IF NOT EXISTS public.whatsapp_visit_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viewing_id uuid NOT NULL REFERENCES public.viewings(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  request_id uuid,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  route_key text NOT NULL CHECK (route_key IN ('barka','muscat')),
  step integer NOT NULL CHECK (step BETWEEN 1 AND 4),
  status text NOT NULL CHECK (status IN ('awaiting_approval','sending','sent','rejected','superseded','failed','stopped')),
  body text NOT NULL,
  template_name text,
  send_mode text CHECK (send_mode IN ('service','template')),
  anchor_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  sent_at timestamptz,
  meta_message_id text,
  decided_by uuid,
  decided_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_visit_followups_one_open
  ON public.whatsapp_visit_followups (viewing_id) WHERE status IN ('awaiting_approval','sending');
CREATE INDEX IF NOT EXISTS whatsapp_visit_followups_status_idx ON public.whatsapp_visit_followups (company_id, status, created_at DESC);
ALTER TABLE public.whatsapp_visit_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visit_followups_owner_read ON public.whatsapp_visit_followups;
CREATE POLICY visit_followups_owner_read ON public.whatsapp_visit_followups FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.whatsapp_visit_followups FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_visit_followups FROM authenticated;
GRANT SELECT ON public.whatsapp_visit_followups TO authenticated;

-- Wording per step (Meta template visit_followup_<step>_ar_v1 carries the same text).
CREATE OR REPLACE FUNCTION public.crm_visit_followup_text(p_step integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE p_step
    WHEN 1 THEN 'بخصوص الزيارة قدرت تشوف العقار ؟ كيف لقيته ؟'
    WHEN 2 THEN 'اذا العقار ما ناسبك خبرني ايش اللي تدور عليه بالضبط عشان اشوف لك شي يناسبك'
    WHEN 3 THEN 'لين الحين تدور على عقار ؟ اذا تحب برسلك المتوفر عندنا الحين'
    WHEN 4 THEN 'اذا لين الحين ما حصلت اللي يناسبك خبرني وبشوف لك الجديد اول ما يتوفر'
  END
$function$;

CREATE OR REPLACE FUNCTION public.crm_queue_visit_followups(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  c record; o record;
  v_hour int := extract(hour FROM (now() AT TIME ZONE 'Asia/Muscat'));
  v_offsets int[] := ARRAY[1, 3, 7, 30];
  v_last_in timestamptz; v_last_human timestamptz; v_anchor timestamptz;
  v_since_anchor int; v_total int; v_unanswered int; v_last_sent timestamptz; v_due timestamptz;
  v_queued int := 0; v_stopped int := 0; v_superseded int := 0;
BEGIN
  IF v_hour < 9 OR v_hour >= 21 THEN RETURN jsonb_build_object('ok', true, 'reason', 'outside_hours'); END IF;
  FOR c IN
    WITH v AS (
      SELECT DISTINCT ON (vw.client_id) vw.id AS viewing_id, vw.company_id, vw.client_id, vw.request_id,
             ((vw.viewing_date + coalesce(vw.viewing_time, time '17:00')) AT TIME ZONE 'Asia/Muscat') AS visit_at
        FROM public.viewings vw
       WHERE vw.status = 'done' AND coalesce(vw.archived, false) = false
         -- visits from the go-live day on; older visits were already followed up by staff
         AND vw.viewing_date >= greatest(date '2026-11-02', (now() AT TIME ZONE 'Asia/Muscat')::date - 60)
       ORDER BY vw.client_id, vw.viewing_date DESC, vw.viewing_time DESC NULLS LAST
    )
    SELECT v.*, cv.id AS conversation_id, cv.route_key, coalesce(cv.human_handoff_required, false) AS handoff
      FROM v
      JOIN public.clients cl ON cl.id = v.client_id AND coalesce(cl.archived, false) = false AND coalesce(cl.phone, '') <> ''
      JOIN LATERAL (
        SELECT wc.id, wc.route_key, wc.human_handoff_required FROM public.whatsapp_conversations wc
         WHERE wc.client_id = v.client_id AND wc.company_id = v.company_id AND wc.route_key IN ('barka','muscat')
         ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
      ) cv ON true
     WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_visit_followups s WHERE s.viewing_id = v.viewing_id AND s.status = 'stopped')
  LOOP
    SELECT max(m.message_timestamp) FILTER (WHERE m.direction = 'inbound'),
           max(m.message_timestamp) FILTER (WHERE m.direction = 'outbound' AND m.actor_type = 'human')
      INTO v_last_in, v_last_human
      FROM public.whatsapp_messages m WHERE m.conversation_id = c.conversation_id;

    -- a waiting follow-up goes stale as soon as the customer or staff write
    FOR o IN SELECT * FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status = 'awaiting_approval' LOOP
      IF coalesce(v_last_in, '-infinity') > o.created_at OR coalesce(v_last_human, '-infinity') > o.created_at THEN
        UPDATE public.whatsapp_visit_followups SET status = 'superseded', updated_at = now() WHERE id = o.id;
        v_superseded := v_superseded + 1;
      END IF;
    END LOOP;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status IN ('awaiting_approval','sending'));

    -- "ما أبي" and similar → stop for good
    IF EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.conversation_id = c.conversation_id AND m.direction = 'inbound'
                AND m.message_timestamp > c.visit_at
                AND coalesce(m.transcript, m.body, '') ~* '(ما ابي|ما أبي|ما ابغى|ما أبغى|مو مهتم|ما مهتم|غير مهتم|لا تراسل|لا ترسل|وقف المتابعة|stop|unsubscribe)') THEN
      INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, anchor_at, due_at, error)
      VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, 1, 'stopped', '-', c.visit_at, now(), 'customer_declined');
      IF c.request_id IS NOT NULL THEN
        INSERT INTO public.whatsapp_followup_optouts (request_id, company_id, client_id, reason)
        VALUES (c.request_id, c.company_id, c.client_id, 'visit_followup_declined') ON CONFLICT (request_id) DO NOTHING;
      END IF;
      v_stopped := v_stopped + 1; CONTINUE;
    END IF;

    -- a step the owner skipped counts as used (it is not proposed again), but not as unanswered
    SELECT count(*) FILTER (WHERE f.status = 'sent' AND f.sent_at > coalesce(v_last_in, '-infinity')), count(*),
           max(coalesce(f.sent_at, f.decided_at))
      INTO v_unanswered, v_total, v_last_sent
      FROM public.whatsapp_visit_followups f WHERE f.viewing_id = c.viewing_id AND f.status IN ('sent','rejected');
    IF v_unanswered >= 3 THEN
      INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, anchor_at, due_at, error)
      VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, least(v_total, 4), 'stopped', '-', c.visit_at, now(), 'no_response_3');
      IF c.request_id IS NOT NULL THEN
        INSERT INTO public.whatsapp_followup_optouts (request_id, company_id, client_id, reason)
        VALUES (c.request_id, c.company_id, c.client_id, 'visit_followup_no_response') ON CONFLICT (request_id) DO NOTHING;
      END IF;
      v_stopped := v_stopped + 1; CONTINUE;
    END IF;
    CONTINUE WHEN v_total >= 4 OR c.handoff;
    CONTINUE WHEN coalesce(v_last_in, '-infinity') > now() - interval '48 hours';
    CONTINUE WHEN coalesce(v_last_sent, '-infinity') > now() - interval '2 days';

    v_anchor := greatest(c.visit_at, coalesce(v_last_human, c.visit_at));
    SELECT count(*) INTO v_since_anchor FROM public.whatsapp_visit_followups f
     WHERE f.viewing_id = c.viewing_id AND f.status IN ('sent','rejected') AND coalesce(f.sent_at, f.decided_at) > v_anchor;
    CONTINUE WHEN v_since_anchor >= 4;
    v_due := v_anchor + make_interval(days => v_offsets[v_since_anchor + 1]);
    CONTINUE WHEN now() < v_due;

    INSERT INTO public.whatsapp_visit_followups (company_id, viewing_id, client_id, request_id, conversation_id, route_key, step, status, body, template_name, anchor_at, due_at)
    VALUES (c.company_id, c.viewing_id, c.client_id, c.request_id, c.conversation_id, c.route_key, v_total + 1, 'awaiting_approval',
            public.crm_visit_followup_text(v_total + 1), 'visit_followup_' || (v_total + 1) || '_ar_v1', v_anchor, v_due);
    v_queued := v_queued + 1;
    EXIT WHEN v_queued >= greatest(1, least(coalesce(p_limit, 20), 50));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'queued', v_queued, 'stopped', v_stopped, 'superseded', v_superseded);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_queue_visit_followups(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_visit_followup_text(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_visit_followup_text(integer) TO authenticated;

-- Owner skips a waiting follow-up (the next step stays on schedule).
CREATE OR REPLACE FUNCTION public.crm_visit_followup_reject(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_visit_followups SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = p_id AND company_id = public.my_company() AND status = 'awaiting_approval';
  IF NOT FOUND THEN RAISE EXCEPTION 'followup_not_pending' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_visit_followup_reject(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_visit_followup_reject(uuid) TO authenticated;

-- Queue job: every hour at :05. It only prepares follow-ups for approval; it never sends.
-- (The old habib_whatsapp_followups_hourly job stays disabled.)
SELECT cron.schedule('habib_visit_followups_queue', '5 * * * *', $$SELECT public.crm_queue_visit_followups(20)$$);
