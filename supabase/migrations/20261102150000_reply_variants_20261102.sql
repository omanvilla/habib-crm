-- SQL53: A/B/C wordings for pinned replies and their results.
-- A is the pinned reply itself (whatsapp_reply_rules.approved_reply); B and C live here.
-- The reply agent rotates between the active wordings and records the label it used in
-- whatsapp_reply_drafts.analysis.variant_label. Owner-only read, writes through RPCs.
CREATE TABLE IF NOT EXISTS public.whatsapp_reply_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.whatsapp_reply_rules(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN ('B','C')),
  reply text NOT NULL CHECK (length(btrim(reply)) BETWEEN 1 AND 2000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, label)
);
ALTER TABLE public.whatsapp_reply_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reply_variants_owner_read ON public.whatsapp_reply_variants;
CREATE POLICY reply_variants_owner_read ON public.whatsapp_reply_variants FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.whatsapp_reply_variants FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_reply_variants FROM authenticated;
GRANT SELECT ON public.whatsapp_reply_variants TO authenticated;

-- Save (or clear, when p_reply is empty) wording B or C of a pinned reply.
CREATE OR REPLACE FUNCTION public.crm_reply_variant_save(p_rule_id uuid, p_label text, p_reply text, p_active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_text text := btrim(coalesce(p_reply, ''));
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF p_label NOT IN ('B','C') THEN RAISE EXCEPTION 'bad_label' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_reply_rules r WHERE r.id = p_rule_id AND r.company_id = v_company) THEN
    RAISE EXCEPTION 'rule_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_text = '' THEN
    DELETE FROM public.whatsapp_reply_variants WHERE rule_id = p_rule_id AND label = p_label AND company_id = v_company;
    RETURN jsonb_build_object('ok', true, 'removed', true);
  END IF;
  INSERT INTO public.whatsapp_reply_variants (company_id, rule_id, label, reply, active, created_by)
  VALUES (v_company, p_rule_id, p_label, v_text, coalesce(p_active, true), auth.uid())
  ON CONFLICT (rule_id, label) DO UPDATE SET reply = excluded.reply, active = excluded.active, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Results per pinned reply and wording. Each sent reply is followed for:
-- reply within 24h, viewing request within 14 days (a viewing created, or the customer asking
-- to see / for the location), visit done within 30 days, call within 14 days (staff note that
-- mentions a call, or the customer asking for one; there is no call log), deal within 60 days.
CREATE OR REPLACE FUNCTION public.crm_reply_variant_stats(p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v jsonb;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  WITH s AS (
    SELECT d.id, d.client_id, d.conversation_id, d.sent_at,
           (d.analysis->>'matched_rule_id')::uuid AS rule_id,
           coalesce(nullif(d.analysis->>'variant_label', ''), 'A') AS label,
           coalesce(d.analysis->>'approved_edited', '') = 'true' AS edited
      FROM public.whatsapp_reply_drafts d
     WHERE d.company_id = v_company AND d.status = 'sent' AND d.sent_at IS NOT NULL
       AND d.sent_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
       AND coalesce(d.analysis->>'matched_rule_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), m AS (
    SELECT s.*,
      EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.conversation_id = s.conversation_id AND w.direction = 'inbound'
               AND w.message_timestamp > s.sent_at AND w.message_timestamp <= s.sent_at + interval '24 hours') AS replied,
      (EXISTS (SELECT 1 FROM public.viewings v WHERE v.client_id = s.client_id AND v.company_id = v_company
               AND v.created_at > s.sent_at AND v.created_at <= s.sent_at + interval '14 days')
       OR EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.conversation_id = s.conversation_id AND w.direction = 'inbound'
               AND w.message_timestamp > s.sent_at AND w.message_timestamp <= s.sent_at + interval '14 days'
               AND coalesce(w.transcript, w.body, '') ~* '(زيار|معاين|اشوف|أشوف|موقع|لوكيشن|location|visit)')) AS viewing_request,
      EXISTS (SELECT 1 FROM public.viewings v WHERE v.client_id = s.client_id AND v.company_id = v_company AND v.status = 'done'
               AND v.viewing_date >= (s.sent_at AT TIME ZONE 'Asia/Muscat')::date
               AND v.viewing_date <= (s.sent_at AT TIME ZONE 'Asia/Muscat')::date + 30) AS visit,
      (EXISTS (SELECT 1 FROM public.activities a WHERE a.client_id = s.client_id AND a.company_id = v_company
               AND a.created_at > s.sent_at AND a.created_at <= s.sent_at + interval '14 days'
               AND coalesce(a.activity_text, a.description, '') ~* '(اتصال|اتصل|مكالم|call)')
       OR EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.conversation_id = s.conversation_id AND w.direction = 'inbound'
               AND w.message_timestamp > s.sent_at AND w.message_timestamp <= s.sent_at + interval '14 days'
               AND coalesce(w.transcript, w.body, '') ~* '(اتصل|كلمني|مكالم|call me)')) AS call,
      EXISTS (SELECT 1 FROM public.deals dl WHERE dl.client_id = s.client_id AND dl.company_id = v_company
               AND dl.created_at > s.sent_at AND dl.created_at <= s.sent_at + interval '60 days'
               AND dl.stage IS DISTINCT FROM 'lost') AS deal
    FROM s
  ), g AS (
    SELECT rule_id, label, count(*) AS sent, count(*) FILTER (WHERE edited) AS edited,
           count(*) FILTER (WHERE replied) AS replied, count(*) FILTER (WHERE viewing_request) AS viewing_requests,
           count(*) FILTER (WHERE visit) AS visits, count(*) FILTER (WHERE call) AS calls, count(*) FILTER (WHERE deal) AS deals
      FROM m GROUP BY rule_id, label
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'rule_id', r.id, 'situation', r.situation, 'active', r.active, 'label', l.label,
           'reply', CASE WHEN l.label = 'A' THEN r.approved_reply ELSE vr.reply END,
           'variant_active', CASE WHEN l.label = 'A' THEN r.active ELSE coalesce(vr.active, false) END,
           'sent', coalesce(g.sent, 0), 'edited', coalesce(g.edited, 0), 'replied', coalesce(g.replied, 0),
           'viewing_requests', coalesce(g.viewing_requests, 0), 'visits', coalesce(g.visits, 0),
           'calls', coalesce(g.calls, 0), 'deals', coalesce(g.deals, 0))
         ORDER BY r.created_at DESC, l.label), '[]'::jsonb)
    INTO v
    FROM public.whatsapp_reply_rules r
    CROSS JOIN (VALUES ('A'), ('B'), ('C')) AS l(label)
    LEFT JOIN public.whatsapp_reply_variants vr ON vr.rule_id = r.id AND vr.label = l.label
    LEFT JOIN g ON g.rule_id = r.id AND g.label = l.label
   WHERE r.company_id = v_company AND (l.label = 'A' OR vr.id IS NOT NULL OR g.sent IS NOT NULL);
  RETURN jsonb_build_object('days', p_days, 'rows', v);
END
$function$;

REVOKE ALL ON FUNCTION public.crm_reply_variant_save(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_reply_variant_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_reply_variant_save(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reply_variant_stats(integer) TO authenticated;
