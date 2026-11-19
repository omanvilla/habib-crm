-- SQL144 (19 Nov 2026, Ahmed: «فاحص الردود الآلية مرتين باليوم … تطوير لمدرّب الردود الموجود»).
-- Twice a day (07:30 and 14:30 Muscat, every day) the function whatsapp-reply-audit reads what the reply agent did since the
-- last run (sent, skipped, failed, chats left with no reply), judges the replies against the brain, whatsapp_reply_rules and
-- docs/agent-rules.md, and writes one run + at most 5 grouped findings. A critical finding (invented price or fact, a sold /
-- reserved property offered, a serious buyer not handed over) mutes the agent on that chat at once (agent_muted, the same
-- switch «كمّل يا عقل» clears) and Ahmed is told on WhatsApp and in the CRM without waiting for the report.
-- Ahmed chooses in the Claude chat: crm_reply_audit_open / crm_reply_audit_decide / crm_reply_audit_apply (no user session,
-- service role and postgres only). The CRM card reads crm_reply_audit_card() (owner only, read only).
-- The weekly reply_coach_weekly is not touched.
-- Rollback: 144-reply-audit.rollback.sql (drops only what this file made; the tables are dropped only if empty).

CREATE TABLE IF NOT EXISTS public.whatsapp_reply_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  checked_count integer NOT NULL DEFAULT 0,
  replied_clients jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings_count integer NOT NULL DEFAULT 0,
  system_health jsonb NOT NULL DEFAULT '{"status":"ok","reasons":[]}'::jsonb,
  summary text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_sent boolean NOT NULL DEFAULT false,
  trigger text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_reply_audit_runs_company_idx ON public.whatsapp_reply_audit_runs (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_reply_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.whatsapp_reply_audit_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  customer_name text,
  phone text,
  customer_message text,
  ai_reply text,
  draft_id uuid REFERENCES public.whatsapp_reply_drafts(id) ON DELETE SET NULL,
  error_type text NOT NULL,
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('critical','normal')),
  explanation text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  repeat_of_rule_id uuid REFERENCES public.whatsapp_reply_rules(id) ON DELETE SET NULL,
  repeat_of_r text,
  conversations jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the other chats with the same mistake (grouped item)
  conversations_count integer NOT NULL DEFAULT 1,
  paused boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','decided','rule_applied','ignored')),
  ahmed_choice integer,
  ahmed_custom_reply text,
  decided_at timestamptz,
  rule_id uuid REFERENCES public.whatsapp_reply_rules(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_reply_audit_findings_open_idx ON public.whatsapp_reply_audit_findings (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_reply_audit_findings_run_idx ON public.whatsapp_reply_audit_findings (run_id);

ALTER TABLE public.whatsapp_reply_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reply_audit_findings ENABLE ROW LEVEL SECURITY;
-- no policies: browsers read only through crm_reply_audit_card(); the function writes with the service role
REVOKE ALL ON public.whatsapp_reply_audit_runs, public.whatsapp_reply_audit_findings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_reply_audit_runs, public.whatsapp_reply_audit_findings TO service_role;

-- System health for the run (service role only): cron runs that failed or did not run, Meta free-reply usage per number.
CREATE OR REPLACE FUNCTION public.crm_reply_audit_health(p_company uuid, p_since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_fail jsonb; v_usage jsonb; v_silent jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'failed', x.n, 'last_error', x.msg)), '[]'::jsonb) INTO v_fail
    FROM (SELECT d.jobid, count(*) n, left(max(d.return_message), 200) msg FROM cron.job_run_details d
           WHERE d.start_time >= p_since AND d.status NOT IN ('succeeded','running') GROUP BY d.jobid) x
    JOIN cron.job j ON j.jobid = x.jobid;
  -- the jobs the replies depend on that should have run in the period and did not
  SELECT coalesce(jsonb_agg(j.jobname), '[]'::jsonb) INTO v_silent
    FROM cron.job j
   WHERE j.active AND j.jobname IN ('crm-retry-failed-agent-sends','owner_whatsapp_keepalive','whatsapp_transcribe_voice_notes')
     AND now() - p_since > interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time >= p_since);
  SELECT coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) INTO v_usage FROM crm_repair_private.whatsapp_usage_rows(p_company) u;
  RETURN jsonb_build_object('cron_failed', v_fail, 'cron_silent', v_silent, 'usage', v_usage);
END $$;

-- Chats on the branch numbers whose last customer message (in the period, older than 20 minutes) got nothing:
-- no reply from anyone, no draft after it (or the last draft failed), and nothing that keeps the agent out on purpose.
CREATE OR REPLACE FUNCTION public.crm_reply_audit_unanswered(p_company uuid, p_since timestamptz)
RETURNS TABLE (conversation_id uuid, client_id uuid, name text, phone text, route_key text, last_inbound_at timestamptz,
               last_message text, last_draft_status text, last_draft_error text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH staff AS (SELECT right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 8) p FROM public.profiles WHERE company_id = p_company AND phone IS NOT NULL)
  SELECT c.id, c.client_id, coalesce(nullif(cl.name,''), c.customer_name, c.customer_phone), c.customer_phone, c.route_key, c.last_inbound_at,
         (SELECT left(coalesce(m.transcript, m.body, '['||m.message_type||']'), 200) FROM public.whatsapp_messages m
           WHERE m.conversation_id = c.id AND m.direction = 'inbound' ORDER BY m.message_timestamp DESC LIMIT 1),
         d.status, d.error
    FROM public.whatsapp_conversations c
    LEFT JOIN public.clients cl ON cl.id = c.client_id
    LEFT JOIN LATERAL (SELECT x.status, x.error, x.created_at FROM public.whatsapp_reply_drafts x
                        WHERE x.conversation_id = c.id ORDER BY x.created_at DESC LIMIT 1) d ON true
   WHERE c.company_id = p_company AND c.route_key IN ('barka','muscat')
     AND c.last_inbound_at >= p_since AND c.last_inbound_at < now() - interval '20 minutes'
     AND c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity')
     AND c.ignored_at IS NULL AND NOT coalesce(c.agent_muted, false) AND NOT coalesce(c.human_handoff_required, false)
     AND public.crm_chat_hold(c.id) IS NULL
     AND right(regexp_replace(coalesce(c.customer_phone,''), '\D', '', 'g'), 8) NOT IN (SELECT p FROM staff)
     AND (d.created_at IS NULL OR d.created_at < c.last_inbound_at - interval '2 minutes' OR d.status = 'failed')
   ORDER BY c.last_inbound_at
$$;

-- Card on the owner's home (read only).
CREATE OR REPLACE FUNCTION public.crm_reply_audit_card()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid := public.my_company(); r record; res jsonb;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING errcode = '42501'; END IF;
  SELECT * INTO r FROM public.whatsapp_reply_audit_runs WHERE company_id = v_company ORDER BY created_at DESC LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('run', null); END IF;
  SELECT jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'period_start', r.period_start, 'period_end', r.period_end, 'checked_count', r.checked_count,
                              'replied_clients', r.replied_clients, 'findings_count', r.findings_count, 'system_health', r.system_health,
                              'summary', r.summary, 'created_at', r.created_at),
    'findings', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'customer_name', f.customer_name, 'error_type', f.error_type,
                              'severity', f.severity, 'explanation', f.explanation, 'conversations_count', f.conversations_count,
                              'paused', f.paused, 'status', f.status, 'conversation_id', f.conversation_id) ORDER BY (f.severity = 'critical') DESC, f.created_at)
                            FROM public.whatsapp_reply_audit_findings f WHERE f.run_id = r.id), '[]'::jsonb),
    'open_before', (SELECT count(*) FROM public.whatsapp_reply_audit_findings f
                     WHERE f.company_id = v_company AND f.status = 'open' AND f.run_id <> r.id)
  ) INTO res;
  RETURN res;
END $$;

-- For the Claude chat (no user session): the last report and every open finding in full.
CREATE OR REPLACE FUNCTION public.crm_reply_audit_open()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'run', (SELECT to_jsonb(r) FROM public.whatsapp_reply_audit_runs r ORDER BY r.created_at DESC LIMIT 1),
    'open', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY (f.severity = 'critical') DESC, f.created_at)
                        FROM public.whatsapp_reply_audit_findings f WHERE f.status = 'open'), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.crm_reply_audit_decide(finding_id uuid, choice integer DEFAULT NULL, custom_reply text DEFAULT NULL, ignore boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f public.whatsapp_reply_audit_findings;
BEGIN
  SELECT * INTO f FROM public.whatsapp_reply_audit_findings WHERE id = finding_id FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'finding_not_found'; END IF;
  IF f.status = 'rule_applied' THEN RAISE EXCEPTION 'already_rule_applied'; END IF;
  IF NOT coalesce(ignore, false) THEN
    IF nullif(btrim(coalesce(custom_reply, '')), '') IS NULL AND (choice IS NULL OR choice < 1 OR choice > jsonb_array_length(f.options)) THEN
      RAISE EXCEPTION 'choice_out_of_range';
    END IF;
  END IF;
  UPDATE public.whatsapp_reply_audit_findings
     SET status = CASE WHEN coalesce(ignore, false) THEN 'ignored' ELSE 'decided' END,
         ahmed_choice = CASE WHEN coalesce(ignore, false) THEN NULL ELSE choice END,
         ahmed_custom_reply = CASE WHEN coalesce(ignore, false) THEN NULL ELSE nullif(btrim(coalesce(custom_reply, '')), '') END,
         decided_at = now()
   WHERE id = finding_id RETURNING * INTO f;
  RETURN to_jsonb(f);
END $$;

-- Pin the decided reply as a rule and link it to the findings. The R number, brain.ts / knowledge.ts and the dry run follow
-- «طريقة التعديل» in docs/agent-rules.md and are done in the chat: this only writes the table rows.
CREATE OR REPLACE FUNCTION public.crm_reply_audit_apply(finding_ids uuid[], situation text, approved_reply text, category text DEFAULT 'general', auto_match_regex text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_n integer; v_rule uuid; v_draft uuid; v_owner uuid;
BEGIN
  IF coalesce(array_length(finding_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'finding_ids_required'; END IF;
  IF nullif(btrim(coalesce(situation, '')), '') IS NULL OR nullif(btrim(coalesce(approved_reply, '')), '') IS NULL THEN RAISE EXCEPTION 'situation_and_reply_required'; END IF;
  IF category NOT IN ('buyer','tenant','investor','seller','general','broker','active_deal') THEN RAISE EXCEPTION 'bad_category'; END IF;
  IF auto_match_regex IS NOT NULL THEN PERFORM '' ~ auto_match_regex; END IF;  -- refuses a broken regex
  SELECT count(DISTINCT company_id), min(company_id::text)::uuid INTO v_n, v_company FROM public.whatsapp_reply_audit_findings WHERE id = ANY(finding_ids);
  IF v_n <> 1 THEN RAISE EXCEPTION 'findings_not_found_or_mixed'; END IF;
  IF (SELECT count(*) FROM public.whatsapp_reply_audit_findings WHERE id = ANY(finding_ids)) <> array_length(finding_ids, 1) THEN RAISE EXCEPTION 'finding_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_reply_audit_findings WHERE id = ANY(finding_ids) AND status = 'rule_applied') THEN RAISE EXCEPTION 'already_rule_applied'; END IF;
  SELECT draft_id INTO v_draft FROM public.whatsapp_reply_audit_findings WHERE id = ANY(finding_ids) AND draft_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO v_owner FROM public.profiles WHERE company_id = v_company AND role = 'owner' AND is_active ORDER BY created_at LIMIT 1;
  INSERT INTO public.whatsapp_reply_rules (company_id, situation, approved_reply, source_draft_id, active, category, created_by, auto_send, auto_match_regex, experiment_note)
  VALUES (v_company, btrim(situation), btrim(approved_reply), v_draft, true, category, v_owner, false, auto_match_regex, 'من فحص الردود ' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD'))
  RETURNING id INTO v_rule;
  UPDATE public.whatsapp_reply_audit_findings SET status = 'rule_applied', rule_id = v_rule, decided_at = coalesce(decided_at, now()) WHERE id = ANY(finding_ids);
  RETURN jsonb_build_object('rule_id', v_rule, 'findings', array_length(finding_ids, 1));
END $$;

REVOKE ALL ON FUNCTION public.crm_reply_audit_health(uuid, timestamptz), public.crm_reply_audit_unanswered(uuid, timestamptz),
  public.crm_reply_audit_open(), public.crm_reply_audit_decide(uuid, integer, text, boolean),
  public.crm_reply_audit_apply(uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reply_audit_health(uuid, timestamptz), public.crm_reply_audit_unanswered(uuid, timestamptz),
  public.crm_reply_audit_open(), public.crm_reply_audit_decide(uuid, integer, text, boolean),
  public.crm_reply_audit_apply(uuid[], text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_reply_audit_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_reply_audit_card() TO authenticated;

-- 07:30 and 14:30 Muscat = 03:30 and 10:30 UTC, every day of the week
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('reply_audit_morning','reply_audit_afternoon');
SELECT cron.schedule('reply_audit_morning', '30 3 * * *', $c$select net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-reply-audit', headers:=jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')), body:='{"trigger":"cron"}'::jsonb, timeout_milliseconds:=300000)$c$);
SELECT cron.schedule('reply_audit_afternoon', '30 10 * * *', $c$select net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-reply-audit', headers:=jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')), body:='{"trigger":"cron"}'::jsonb, timeout_milliseconds:=300000)$c$);
