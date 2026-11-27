-- SQL167 (27 Nov 2026, Ahmed: «اللي ما رد عليه توصل له رسالة واتساب تلقائية ... بعد 8 ما في رد كل متصل توصل له رسالة واتساب، ما نقدر
-- نرد الحين، اكتب لنا موضوعك هنا ونرد عليك ... مرام الساعة 8 الصبح تشوف قائمة اتصلوا ما كتبوا ... ورسالة لك بس لو المتصل واقف عند العقار»).
-- The missed-call receptionist:
--   * Each office Android phone (Barka +96892344273, Muscat +96871770030) runs a free automation app (MacroDroid). On every missed
--     call it opens https://…/functions/v1/missed-call?k=<device key>&n=<caller>; once a day it pings (&ping=1) so the morning
--     check knows the phone is alive. Device keys are stored hashed only (crm_repair_private.missed_call_devices).
--   * public.crm_missed_call_plan(key, number) (service role only) records the call (several calls of one number within 30 minutes are
--     one row), finds the client, the chat and the reason Ahmed must hear about it at once (a viewing around this time today, or the
--     caller wrote in the last 3 hours that he is at the property), and decides the WhatsApp: none when the same number got one in the
--     last 12 hours or the chat is held (negotiation / muted); «dry_run» while whatsapp_automation_runtime.missed_call_auto is off.
--   * The edge function missed-call sends it (text inside the 24 hours, else template missed_call_ar_v1), logs it in the chat, alerts
--     Ahmed from the same line when there is a reason, and writes the outcome back (crm_missed_call_done).
--   * crm_repair_private.missed_call_tasks() (cron Sat-Thu 8 AM - 3 PM Oman, hourly): every caller who did not write within 45 minutes
--     gets ONE task «📞 رجّع اتصال» for the line's employee (Maram), due today. Night and Friday calls land at 8 AM. Evening calls (4-8 PM)
--     are left out: they rang through to Ahmed, and his iPhone cannot report which he missed, so Maram must not call back someone
--     he already talked to; they still got the WhatsApp.
--   * Ahmed's phone is an iPhone (27 Nov): 4-8 PM the office phones forward on no answer after 10 seconds (**61), not always (**21),
--     so the office phone still sees every evening call and the caller gets missed_call_evening_ar_v1.
-- Nothing is deleted. Rollback: 167-missed-calls.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.whatsapp_automation_runtime ADD COLUMN IF NOT EXISTS missed_call_auto boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS crm_repair_private.missed_call_devices (
  device text PRIMARY KEY CHECK (device IN ('barka', 'muscat', 'ahmed')),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  line text NOT NULL CHECK (line IN ('barka', 'muscat')),
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_ping_at timestamptz
);
REVOKE ALL ON crm_repair_private.missed_call_devices FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_missed_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device text NOT NULL,
  line text NOT NULL CHECK (line IN ('barka', 'muscat')),
  caller_phone text NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  last_call_at timestamptz NOT NULL DEFAULT now(),
  calls integer NOT NULL DEFAULT 1,
  period text NOT NULL CHECK (period IN ('day', 'evening', 'night', 'friday')),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  wa_status text NOT NULL DEFAULT 'pending' CHECK (wa_status IN ('pending', 'dry_run', 'sent', 'skipped', 'failed')),
  wa_reason text,
  wa_mode text,
  wa_message_id text,
  wa_at timestamptz,
  hot_reason text,
  owner_alert text,
  wrote_back_at timestamptz,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_missed_calls_phone_idx ON public.crm_missed_calls (company_id, caller_phone, last_call_at DESC);
CREATE INDEX IF NOT EXISTS crm_missed_calls_open_idx ON public.crm_missed_calls (called_at) WHERE task_id IS NULL AND wrote_back_at IS NULL;
ALTER TABLE public.crm_missed_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_missed_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_missed_calls TO authenticated;
DROP POLICY IF EXISTS crm_missed_calls_select_staff ON public.crm_missed_calls;
-- the office's own call log: the owner and the employee who calls them back read it; only the functions below write
CREATE POLICY crm_missed_calls_select_staff ON public.crm_missed_calls FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'));

-- the period of a moment in Oman: day 8-16 (Maram answers), evening 16-20 (forwarded to Ahmed), night; Friday is off all day
CREATE OR REPLACE FUNCTION crm_repair_private.missed_call_period(p_at timestamptz)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  SELECT CASE
    WHEN extract(isodow FROM p_at AT TIME ZONE 'Asia/Muscat') = 5 THEN 'friday'
    WHEN extract(hour FROM p_at AT TIME ZONE 'Asia/Muscat') BETWEEN 8 AND 15 THEN 'day'
    WHEN extract(hour FROM p_at AT TIME ZONE 'Asia/Muscat') BETWEEN 16 AND 19 THEN 'evening'
    ELSE 'night' END
$f$;

-- «I am at the property» in a customer's words (normalised Arabic: أ إ آ -> ا, ى -> ي, ة -> ه)
CREATE OR REPLACE FUNCTION crm_repair_private.missed_call_at_property(p_text text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  SELECT translate(coalesce(p_text, ''), 'أإآٱىة', 'اااايه') ~
    '(وصلت|وصلنا|واقف|واقفين|انا عند|احنا عند|نحن عند|انا قدام|احنا قدام|عند الفيلا|عند البيت|عند العقار|عند الارض|عند الباب|قدام الفيلا|قدام البيت|قدام الباب|في الموقع|بالموقع|انا هنا|احنا هنا|نحن هنا|برا الفيلا|برا البيت)'
$f$;

CREATE OR REPLACE FUNCTION public.crm_missed_call_plan(p_key text, p_number text, p_ping boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  d record; v_phone text; v_wa text; v_now timestamptz := now(); v_row public.crm_missed_calls%ROWTYPE;
  v_client record; v_conv record; v_line text; v_hot text; v_hold text; v_auto boolean; v_status text; v_reason text;
  v_service boolean; v_tpl boolean; v_tplname text; v_route record; v_vis record;
BEGIN
  SELECT * INTO d FROM crm_repair_private.missed_call_devices WHERE key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  IF d.device IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_key'); END IF;
  UPDATE crm_repair_private.missed_call_devices SET last_seen_at = v_now, last_ping_at = CASE WHEN p_ping THEN v_now ELSE last_ping_at END WHERE device = d.device;
  IF p_ping THEN RETURN jsonb_build_object('ok', true, 'ping', true, 'device', d.device); END IF;

  v_phone := public.normalize_crm_phone(p_number);
  IF v_phone IS NULL THEN RETURN jsonb_build_object('ok', true, 'ignored', 'hidden_or_bad_number'); END IF;
  v_wa := ltrim(v_phone, '+');
  -- our own lines and our own people are not customers
  IF EXISTS (SELECT 1 FROM public.company_lead_routes r WHERE r.company_id = d.company_id AND public.normalize_crm_phone(r.whatsapp_number) = v_phone)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = d.company_id AND public.normalize_crm_phone(p.phone) = v_phone)
     OR EXISTS (SELECT 1 FROM public.whatsapp_automation_runtime r WHERE r.company_id = d.company_id AND public.normalize_crm_phone(r.approver_phone) = v_phone) THEN
    RETURN jsonb_build_object('ok', true, 'ignored', 'our_number');
  END IF;

  -- several rings of one number within 30 minutes are one missed call
  SELECT * INTO v_row FROM public.crm_missed_calls m
   WHERE m.company_id = d.company_id AND m.caller_phone = v_phone AND m.last_call_at > v_now - interval '30 minutes'
   ORDER BY m.last_call_at DESC LIMIT 1 FOR UPDATE;
  IF v_row.id IS NOT NULL THEN
    UPDATE public.crm_missed_calls SET calls = calls + 1, last_call_at = v_now WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'merged', true, 'id', v_row.id);
  END IF;

  SELECT c.id, c.name INTO v_client FROM public.clients c
   WHERE c.company_id = d.company_id AND c.phone_normalized = v_phone AND NOT coalesce(c.archived, false)
   ORDER BY c.last_contact_at DESC NULLS LAST LIMIT 1;

  -- the line the message goes from: the office phone that rang; for Ahmed's own phone (forwarded calls) the line of the caller's
  -- latest chat, else Barka
  v_line := d.line;
  IF d.device = 'ahmed' THEN
    SELECT w.route_key INTO v_line FROM public.whatsapp_conversations w
     WHERE w.company_id = d.company_id AND w.customer_wa_id = v_wa AND w.route_key IN ('barka', 'muscat')
     ORDER BY w.last_message_at DESC NULLS LAST LIMIT 1;
    v_line := coalesce(v_line, 'barka');
  END IF;
  SELECT r.meta_phone_number_id, r.assigned_to, r.whatsapp_number INTO v_route FROM public.company_lead_routes r
   WHERE r.company_id = d.company_id AND r.route_key = v_line AND r.is_active;
  SELECT w.id, w.last_inbound_at, w.client_id INTO v_conv FROM public.whatsapp_conversations w
   WHERE w.company_id = d.company_id AND w.meta_phone_number_id = v_route.meta_phone_number_id AND w.customer_wa_id = v_wa;

  -- why Ahmed must hear about it now, even after 8 PM
  SELECT v.viewing_time, coalesce(p.title, p.area, '') AS what INTO v_vis
    FROM public.viewings v LEFT JOIN public.properties p ON p.id = v.property_id
   WHERE v.company_id = d.company_id AND v.client_id = coalesce(v_client.id, v_conv.client_id)
     AND v.viewing_date = (v_now AT TIME ZONE 'Asia/Muscat')::date AND v.status = 'scheduled' AND NOT coalesce(v.archived, false)
     AND (v.viewing_time IS NULL OR v.viewing_time BETWEEN ((v_now AT TIME ZONE 'Asia/Muscat') - interval '3 hours')::time AND ((v_now AT TIME ZONE 'Asia/Muscat') + interval '3 hours')::time
          OR (v_now AT TIME ZONE 'Asia/Muscat')::time < '03:00' OR (v_now AT TIME ZONE 'Asia/Muscat')::time > '21:00')
   ORDER BY v.viewing_time NULLS LAST LIMIT 1;
  IF FOUND THEN
    v_hot := 'عنده معاينة اليوم' || coalesce(' الساعة ' || to_char(v_vis.viewing_time, 'HH12:MI'), '') || CASE WHEN v_vis.what <> '' THEN ' (' || v_vis.what || ')' ELSE '' END;
  ELSIF EXISTS (SELECT 1 FROM public.whatsapp_messages m JOIN public.whatsapp_conversations w ON w.id = m.conversation_id
                 WHERE w.company_id = d.company_id AND w.customer_wa_id = v_wa AND m.direction = 'inbound'
                   AND m.message_timestamp > v_now - interval '3 hours'
                   AND crm_repair_private.missed_call_at_property(coalesce(m.body, '') || ' ' || coalesce(m.transcript, ''))) THEN
    v_hot := 'كتب إنه عند العقار';
  END IF;

  -- the WhatsApp to the caller
  SELECT coalesce(bool_or(r.missed_call_auto), false) INTO v_auto FROM public.whatsapp_automation_runtime r WHERE r.company_id = d.company_id;
  v_hold := CASE WHEN v_conv.id IS NOT NULL THEN public.crm_chat_hold(v_conv.id) END;
  v_service := v_conv.last_inbound_at IS NOT NULL AND v_conv.last_inbound_at > v_now - interval '23 hours';
  -- 4-8 PM the office phone rings 10 seconds and then goes to Ahmed (iPhone: it cannot tell us which calls he missed), so every
  -- evening caller gets the wording that fits whether Ahmed answered or not
  v_tplname := CASE WHEN crm_repair_private.missed_call_period(v_now) = 'evening' THEN 'missed_call_evening_ar_v1' ELSE 'missed_call_ar_v1' END;
  v_tpl := EXISTS (SELECT 1 FROM public.whatsapp_template_registry t WHERE t.company_id = d.company_id AND t.route_key = v_line
                    AND t.template_name = v_tplname AND upper(t.status) = 'APPROVED');
  IF EXISTS (SELECT 1 FROM public.crm_missed_calls m WHERE m.company_id = d.company_id AND m.caller_phone = v_phone
              AND m.wa_status IN ('sent', 'dry_run') AND m.wa_at > v_now - interval '12 hours') THEN
    v_status := 'skipped'; v_reason := 'got_one_in_12h';
  ELSIF v_hold IN ('negotiation', 'muted') THEN
    v_status := 'skipped'; v_reason := 'chat_held_' || v_hold;
  ELSIF v_route.meta_phone_number_id IS NULL THEN
    v_status := 'failed'; v_reason := 'line_not_ready';
  ELSIF NOT v_auto THEN
    v_status := 'dry_run'; v_reason := CASE WHEN v_service THEN 'would_send_text' WHEN v_tpl THEN 'would_send_template' ELSE 'template_not_approved_yet' END;
  ELSIF NOT v_service AND NOT v_tpl THEN
    v_status := 'failed'; v_reason := 'template_not_approved_yet';
  ELSE
    v_status := 'pending';
  END IF;

  INSERT INTO public.crm_missed_calls (company_id, device, line, caller_phone, called_at, last_call_at, period, client_id, conversation_id,
                                       wa_status, wa_reason, wa_mode, wa_at, hot_reason)
  VALUES (d.company_id, d.device, v_line, v_phone, v_now, v_now, crm_repair_private.missed_call_period(v_now), coalesce(v_client.id, v_conv.client_id), v_conv.id,
          v_status, v_reason, CASE WHEN v_service THEN 'text' ELSE 'template' END, CASE WHEN v_status = 'dry_run' THEN v_now END, v_hot)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'company_id', d.company_id, 'device', d.device, 'line', v_line, 'phone', v_phone, 'wa', v_wa,
    'client_id', v_row.client_id, 'client_name', v_client.name, 'conversation_id', v_conv.id, 'assigned_to', v_route.assigned_to,
    'meta_phone_number_id', v_route.meta_phone_number_id, 'inbound_number', v_route.whatsapp_number, 'period', v_row.period,
    'send', v_status = 'pending', 'mode', v_row.wa_mode, 'template', v_tplname, 'wa_status', v_status, 'wa_reason', v_reason, 'hot', v_hot);
END $function$;
REVOKE ALL ON FUNCTION public.crm_missed_call_plan(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_missed_call_plan(text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_missed_call_done(p_id uuid, p_status text, p_reason text, p_message_id text, p_conversation uuid, p_owner_alert text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $f$
  UPDATE public.crm_missed_calls SET
    wa_status = CASE WHEN p_status IN ('sent', 'failed', 'skipped', 'dry_run') THEN p_status ELSE wa_status END,
    wa_reason = coalesce(p_reason, wa_reason), wa_message_id = coalesce(p_message_id, wa_message_id),
    wa_at = CASE WHEN p_status = 'sent' THEN now() ELSE wa_at END,
    conversation_id = coalesce(p_conversation, conversation_id), owner_alert = coalesce(p_owner_alert, owner_alert)
  WHERE id = p_id
$f$;
REVOKE ALL ON FUNCTION public.crm_missed_call_done(uuid, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_missed_call_done(uuid, text, text, text, uuid, text) TO service_role;

-- Maram's call-back list: one task per caller who did not write, due today
CREATE OR REPLACE FUNCTION crm_repair_private.missed_call_tasks()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE x record; n integer := 0; v_task uuid; v_who uuid;
BEGIN
  -- who wrote after the call is the WhatsApp's job, not a call-back
  UPDATE public.crm_missed_calls m SET wrote_back_at = (
      SELECT min(g.message_timestamp) FROM public.whatsapp_messages g JOIN public.whatsapp_conversations w ON w.id = g.conversation_id
       WHERE w.company_id = m.company_id AND w.customer_wa_id = ltrim(m.caller_phone, '+') AND g.direction = 'inbound' AND g.message_timestamp > m.called_at)
   WHERE m.task_id IS NULL AND m.wrote_back_at IS NULL AND m.called_at > now() - interval '4 days'
     AND EXISTS (SELECT 1 FROM public.whatsapp_messages g JOIN public.whatsapp_conversations w ON w.id = g.conversation_id
                  WHERE w.company_id = m.company_id AND w.customer_wa_id = ltrim(m.caller_phone, '+') AND g.direction = 'inbound' AND g.message_timestamp > m.called_at);

  FOR x IN
    SELECT m.company_id, m.caller_phone, max(m.line) FILTER (WHERE m.last_call_at = mx.last_at) AS line, sum(m.calls)::int AS calls,
           mx.last_at, (array_agg(m.client_id ORDER BY m.last_call_at DESC) FILTER (WHERE m.client_id IS NOT NULL))[1] AS client_id,
           array_agg(m.id) AS ids
      FROM public.crm_missed_calls m
      JOIN (SELECT company_id, caller_phone, max(last_call_at) AS last_at FROM public.crm_missed_calls
             WHERE task_id IS NULL AND wrote_back_at IS NULL AND called_at > now() - interval '4 days' AND period <> 'evening' GROUP BY 1, 2) mx
        ON mx.company_id = m.company_id AND mx.caller_phone = m.caller_phone
     WHERE m.task_id IS NULL AND m.wrote_back_at IS NULL AND m.called_at > now() - interval '4 days' AND m.period <> 'evening'
     GROUP BY m.company_id, m.caller_phone, mx.last_at
    HAVING mx.last_at < now() - interval '45 minutes'
  LOOP
    SELECT r.assigned_to INTO v_who FROM public.company_lead_routes r WHERE r.company_id = x.company_id AND r.route_key = x.line;
    INSERT INTO public.tasks (company_id, user_id, client_id, title, notes, due_date, priority, done)
    VALUES (x.company_id, v_who, x.client_id,
            '📞 رجّع اتصال: ' || coalesce((SELECT nullif(c.name, '') FROM public.clients c WHERE c.id = x.client_id), 'رقم جديد') || ' ' || right(x.caller_phone, 8),
            'اتصل على رقم ' || CASE x.line WHEN 'barka' THEN 'بركاء' ELSE 'مسقط' END || ' '
              || to_char(x.last_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH12:MI') || CASE WHEN extract(hour FROM x.last_at AT TIME ZONE 'Asia/Muscat') < 12 THEN ' ص' ELSE ' م' END
              || CASE WHEN x.calls > 1 THEN ' (' || x.calls || ' مرات)' ELSE '' END
              || E' وما رد عليه أحد وما كتب لنا في الواتساب.\nاتصل فيه وشوف وش يبي، وسجّل الاتصال.',
            (now() AT TIME ZONE 'Asia/Muscat')::date, 'high', false)
    RETURNING id INTO v_task;
    UPDATE public.crm_missed_calls SET task_id = v_task WHERE id = ANY (x.ids);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.missed_call_tasks() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm_missed_call_tasks';
-- 8 AM - 3 PM Oman (04-11 UTC), Saturday to Thursday
SELECT cron.schedule('crm_missed_call_tasks', '2 4-11 * * 0-4,6', $$ select crm_repair_private.missed_call_tasks(); $$);
-- the two templates' Meta status, hourly (missed_call_ar_v1 / missed_call_evening_ar_v1 into whatsapp_template_registry)
SELECT cron.schedule('missed_call_templates_refresh', '17 * * * *', $$ select net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/missed-call', headers:=jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')), body:='{"action":"templates","submit":false}'::jsonb, timeout_milliseconds:=60000); $$);
