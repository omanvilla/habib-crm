-- SQL164 (27 Nov 2026, Ahmed: «نعم سوي اللي نصحتني فيه بس بدون ما تخرب النظام اللي ماشين عليه»):
-- recommendations 1, 2, 3 and 5 of the full audit (/mnt/project-files/audit/full-audit-20261127.md).
-- Nothing here sends a message to a customer or an owner: tasks for staff only.
--   1. «ردي على العملاء المنتظرين»: crm_repair_private.waiting_customers_tasks() keeps ONE open task per responsible
--      person (the person the line is assigned_to, else the owner) listing the customers whose last message got no
--      reply at all for 2 hours to 7 days (not ignored / marked done on the WhatsApp page, not a «no reply needed»
--      message, not a reply waiting for Ahmed's approval, not one of our own numbers). Runs 8, 10, 12, 14, 16, 18 Muscat,
--      Sunday-Thursday. It only edits / closes the tasks it created itself (crm_repair_private.waiting_tasks).
--      Priority «high» when somebody waits more than 24 hours (the CRM has no generic bell for staff, so no notification).
--   2. crm_call_next(): owners who answered the price study («accepted» / «counter_offer») and nobody called since,
--      then owners who never answered the «your study is ready» message for 3+ days, come FIRST, with a one-line
--      reason ('why'). Accepted / counter-offer owners were not in the list at all before.
--   3. Server load: owner_price_study_tick (every minute, 1,440 edge calls a day, mostly idle) calls the function only
--      when a study is queued or sending; sheet sync every 15 minutes instead of 5 (last write was 19 Nov).
--   5. crm_office_snapshot(): a desk whose job never ran yet shows status 'soon' («ينتظر أول تشغيل») instead of
--      «موقوف» / «متأخر» (the hunter and the referrals before their first Sunday).
-- Rollback: 164-audit-followups.rollback.sql

-- ---------------- 1. waiting customers ----------------
CREATE TABLE IF NOT EXISTS crm_repair_private.waiting_tasks (
  task_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON crm_repair_private.waiting_tasks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.waiting_customers_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  grp record; t uuid; wt crm_repair_private.waiting_tasks; res jsonb := '[]'::jsonb; body text;
BEGIN
  FOR grp IN
    WITH ours AS (  -- our own numbers: staff / owner phones and the lines themselves
      SELECT right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 8) p8 FROM public.profiles p WHERE coalesce(p.phone, '') <> ''
      UNION SELECT right(regexp_replace(coalesce(lr.whatsapp_number, ''), '\D', '', 'g'), 8) FROM public.company_lead_routes lr WHERE coalesce(lr.whatsapp_number, '') <> ''
    ), w AS (
      SELECT cv.company_id, cv.id, cv.route_key, cv.last_inbound_at,
             coalesce(nullif(btrim(k.name), ''), nullif(btrim(cv.customer_name), ''), 'عميل') nm,
             right(regexp_replace(coalesce(cv.customer_phone, cv.customer_wa_id, ''), '\D', '', 'g'), 8) p8,
             coalesce((SELECT p.id FROM public.profiles p WHERE p.id = lr.assigned_to AND p.is_active AND p.company_id = cv.company_id),
                      (SELECT p.id FROM public.profiles p WHERE p.company_id = cv.company_id AND p.role = 'owner' AND p.is_active ORDER BY p.created_at LIMIT 1)) who
        FROM public.whatsapp_conversations cv
        LEFT JOIN public.clients k ON k.id = cv.client_id
        LEFT JOIN public.company_lead_routes lr ON lr.company_id = cv.company_id AND lr.route_key = cv.route_key
       WHERE cv.route_key IN ('barka', 'muscat')
         AND cv.last_inbound_at > now() - interval '7 days' AND cv.last_inbound_at < now() - interval '2 hours'
         AND cv.last_inbound_at > coalesce(cv.last_outbound_at, '-infinity')
         AND (cv.ignored_at IS NULL OR cv.ignored_at < cv.last_inbound_at)
         AND (cv.waiting_done_at IS NULL OR cv.waiting_done_at < cv.last_inbound_at)
         AND NOT EXISTS (SELECT 1 FROM public.whatsapp_reply_drafts d WHERE d.conversation_id = cv.id
                          AND (d.status = 'pending' OR (d.status = 'skipped' AND d.error = 'no_reply_needed'
                                                         AND d.created_at >= cv.last_inbound_at - interval '1 minute')))
    ), w2 AS (
      SELECT w.*, (SELECT left(regexp_replace(coalesce(nullif(m.body, ''), CASE m.message_type WHEN 'audio' THEN '(رسالة صوتية)' WHEN 'image' THEN '(صورة)' WHEN 'video' THEN '(فيديو)' ELSE '(' || m.message_type || ')' END), '\s+', ' ', 'g'), 70)
                     FROM public.whatsapp_messages m WHERE m.conversation_id = w.id AND m.direction = 'inbound'
                      AND m.message_type NOT IN ('reaction', 'revoke', 'edit', 'unsupported', 'system')
                    ORDER BY m.created_at DESC LIMIT 1) last_msg
        FROM w WHERE length(w.p8) = 8 AND w.p8 NOT IN (SELECT p8 FROM ours WHERE length(p8) = 8) AND w.who IS NOT NULL
    )
    SELECT u.company_id, u.who, count(*) n,
           count(*) FILTER (WHERE u.last_inbound_at < now() - interval '24 hours') old,
           string_agg(format('%s. %s %s (%s) · من %s: «%s»', u.rn, u.nm, u.p8, CASE u.route_key WHEN 'barka' THEN 'بركاء' ELSE 'مسقط' END,
                             CASE WHEN u.hrs < 24 THEN u.hrs || ' ساعة' ELSE (u.hrs / 24) || ' يوم' END, coalesce(u.last_msg, '')), E'\n' ORDER BY u.rn)
             FILTER (WHERE u.rn <= 20) lines
      FROM (SELECT w2.*, floor(extract(epoch FROM now() - w2.last_inbound_at) / 3600)::int hrs,
                   row_number() OVER (PARTITION BY w2.company_id, w2.who ORDER BY w2.last_inbound_at) rn FROM w2) u
     GROUP BY u.company_id, u.who
  LOOP
    SELECT x.* INTO wt FROM crm_repair_private.waiting_tasks x JOIN public.tasks tk ON tk.id = x.task_id
     WHERE x.company_id = grp.company_id AND x.user_id = grp.who AND NOT coalesce(tk.done, false)
     ORDER BY x.created_at DESC LIMIT 1;
    body := 'عملاء كتبوا وما وصلهم أي رد (لا العقل ولا أحد منا)، الأقدم أول. افتح المحادثة في «واتساب» ورد، '
         || 'ولو ما يحتاج رد اضغط «تم» أو «تجاهل» عندها فتنشال من هنا لحالها. القائمة تتحدث كل ساعتين.' || E'\n\n' || grp.lines
         || CASE WHEN grp.n > 20 THEN E'\n…و' || (grp.n - 20) || ' غيرهم في «واتساب».' ELSE '' END;
    IF wt.task_id IS NULL THEN
      INSERT INTO public.tasks (company_id, user_id, title, notes, due_date, priority, done)
      VALUES (grp.company_id, grp.who, 'ردي على العملاء المنتظرين (' || grp.n || ')', body, today,
              CASE WHEN grp.old > 0 THEN 'high' ELSE 'medium' END, false)
      RETURNING id INTO t;
      INSERT INTO crm_repair_private.waiting_tasks (task_id, company_id, user_id) VALUES (t, grp.company_id, grp.who);
    ELSE
      t := wt.task_id;
      UPDATE public.tasks SET title = 'ردي على العملاء المنتظرين (' || grp.n || ')', notes = body, due_date = today,
             priority = CASE WHEN grp.old > 0 THEN 'high' ELSE 'medium' END
       WHERE id = t;
    END IF;
    res := res || jsonb_build_object('user', grp.who, 'waiting', grp.n, 'over_24h', grp.old);
  END LOOP;

  -- nobody waits any more for a person: close the open task this job made for them (only its own tasks)
  UPDATE public.tasks tk SET done = true, completed_at = now(),
         notes = coalesce(tk.notes, '') || E'\n\n✅ ما بقى أحد ينتظر رد (' || to_char(now() AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || ').'
    FROM crm_repair_private.waiting_tasks x
   WHERE x.task_id = tk.id AND NOT coalesce(tk.done, false)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(res) e WHERE (e->>'user')::uuid = x.user_id);
  RETURN res;
END $function$;
REVOKE EXECUTE ON FUNCTION crm_repair_private.waiting_customers_tasks() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_waiting_customers_tasks') THEN
    -- 8, 10, 12, 14, 16, 18 Muscat (minute 17 so it does not start with the other jobs), Sunday-Thursday
    PERFORM cron.schedule('crm_waiting_customers_tasks', '17 4-14/2 * * 0-4', 'select crm_repair_private.waiting_customers_tasks();');
  END IF;
END $cron$;

-- ---------------- 2. «اتصل بعدهم»: owners who answered the study first ----------------
CREATE OR REPLACE FUNCTION public.crm_call_next(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid := public.my_company(); r text := public.my_role(); n integer := greatest(1, least(coalesce(p_limit, 20), 50));
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR coalesce(r, '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'prio')::int, x->>'created_at' DESC) FROM (
     (SELECT jsonb_build_object('lead_id', ol.id, 'client_id', k.id, 'name', k.name, 'phone', k.phone,
               'kind', ol.kind, 'area', ol.area, 'wilayat', ol.wilayat, 'price', ol.price, 'status', ol.status,
               'created_at', ol.created_at, 'prio', p.prio,
               'why', CASE p.prio
                        WHEN 1 THEN CASE st.owner_reaction WHEN 'accepted' THEN 'وافق على سعر الدراسة: اتصل وسجّل العقار'
                                                           ELSE 'رد على الدراسة بسعر ثاني: اتصل وتفاهم معه' END
                        WHEN 2 THEN 'انرسلت له رسالة «دراسة سعر عقارك جاهزة» من '
                                    || ((now() AT TIME ZONE 'Asia/Muscat')::date - (st.updated_at AT TIME ZONE 'Asia/Muscat')::date) || ' يوم وما رد'
                      END,
               'study_days', CASE WHEN p.prio = 3 THEN (now() AT TIME ZONE 'Asia/Muscat')::date - (st.sent_at AT TIME ZONE 'Asia/Muscat')::date END,
               'last_called_at', lc.last_call) x
        FROM public.owner_leads ol
        JOIN public.clients k ON k.id = ol.client_id AND k.company_id = ol.company_id AND coalesce(k.archived, false) = false
        CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g') digits) d
        LEFT JOIN LATERAL (SELECT s.status, s.owner_reaction, s.sent_at, s.updated_at, s.conversation_id
                             FROM public.owner_price_studies s
                            WHERE s.owner_lead_id = ol.id AND s.status IN ('sent', 'waiting_owner')
                            ORDER BY coalesce(s.sent_at, s.updated_at) DESC LIMIT 1) st ON true
        CROSS JOIN LATERAL (SELECT max(a.occurred_at) last_call FROM public.activities a
                             WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                               AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8))) lc
        CROSS JOIN LATERAL (SELECT CASE
            WHEN ol.status = 'studied' AND st.status = 'sent' AND st.owner_reaction IN ('accepted', 'counter_offer')
                 AND coalesce(lc.last_call, '-infinity') < st.sent_at THEN 1
            WHEN ol.status = 'open' AND st.status = 'waiting_owner' AND st.updated_at < now() - interval '3 days'
                 AND coalesce(lc.last_call, '-infinity') < st.updated_at THEN 2
            WHEN ol.status = 'studied' AND st.status = 'sent' AND st.owner_reaction IS NULL AND st.sent_at < now() - interval '7 days'
                 AND coalesce((SELECT w.last_inbound_at FROM public.whatsapp_conversations w WHERE w.id = st.conversation_id), '-infinity') < st.sent_at
                 AND coalesce(lc.last_call, '-infinity') < now() - interval '30 days' THEN 3
            WHEN ol.status = 'open' AND coalesce(lc.last_call, '-infinity') < now() - interval '30 days' THEN 4
          END prio) p
       WHERE ol.company_id = c AND ol.status IN ('open', 'studied') AND p.prio IS NOT NULL AND length(d.digits) >= 8
         AND (r = 'owner' OR (NOT crm_repair_private.owner_line_is_private(ol.company_id, to_jsonb(ol))
                               AND crm_repair_private.can_access_client(c, k.id)))
       ORDER BY p.prio, ol.created_at DESC
       LIMIT n)
     UNION ALL
     (SELECT jsonb_build_object('hunt_id', h.id, 'name', h.name, 'phone', h.phone,
               'kind', CASE h.kind WHEN 'بيت' THEN 'house' ELSE 'villa' END, 'area', h.area, 'wilayat', h.wilayat, 'price', h.price,
               'status', 'hunt', 'link', h.link, 'source', h.source, 'created_at', h.last_new_at, 'prio', 4,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                    AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8))
        FROM public.crm_hunt_leads h
       WHERE h.company_id = c AND h.status = 'new' AND h.last_new_at > now() - interval '21 days'
         AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                          AND a.occurred_at > h.last_new_at AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8)
         AND NOT EXISTS (SELECT 1 FROM public.owner_leads ol JOIN public.clients k ON k.id = ol.client_id
                          WHERE ol.company_id = c AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = h.phone8)
       ORDER BY h.last_new_at DESC
       LIMIT n)) s), '[]'::jsonb);
END $function$;
REVOKE EXECUTE ON FUNCTION public.crm_call_next(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_next(integer) TO authenticated;

-- ---------------- 3. lighter background load ----------------
CREATE INDEX IF NOT EXISTS whatsapp_automation_events_price_study_open_idx
  ON public.whatsapp_automation_events (reason)
  WHERE action_type = 'owner_price_study' AND status = 'detected';

SELECT cron.alter_job(jobid, command := $cmd$
  select net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-agent', (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := '{"action":"price_study_tick"}'::jsonb, timeout_milliseconds := 150000)
   where exists (select 1 from public.whatsapp_automation_events e
                  where e.action_type = 'owner_price_study' and e.status = 'detected' and e.reason in ('queued', 'sending'));
$cmd$) FROM cron.job WHERE jobname = 'owner_price_study_tick';

SELECT cron.alter_job(jobid, schedule := '*/15 * * * *') FROM cron.job WHERE jobname = 'sheet_sync_every_5_min';

-- ---------------- 5. the office: «ينتظر أول تشغيل» ----------------
DO $office$
DECLARE d text := pg_get_functiondef('public.crm_office_snapshot()'::regprocedure);
  a_old text := $o$WHEN d.key = 'hunter' THEN CASE WHEN f.last_out IS NULL THEN 'off' WHEN$o$;
  a_new text := $o$WHEN d.key = 'hunter' THEN CASE WHEN f.last_out IS NULL THEN 'soon' WHEN$o$;
  b_old text := $o$WHEN rn.failed > 0 THEN 'red'
          WHEN rn.last_run IS NULL OR rn.last_run < now() - d.max_age THEN 'yellow'$o$;
  b_new text := $o$WHEN rn.failed > 0 THEN 'red'
          WHEN rn.last_run IS NULL THEN 'soon'
          WHEN rn.last_run < now() - d.max_age THEN 'yellow'$o$;
BEGIN
  IF position(a_new IN d) > 0 AND position(b_new IN d) > 0 THEN RETURN; END IF;  -- already applied
  IF position(a_old IN d) = 0 OR position(b_old IN d) = 0 THEN RAISE EXCEPTION 'office_snapshot_changed_since_sql162'; END IF;
  EXECUTE replace(replace(d, a_old, a_new), b_old, b_new);
END $office$;
