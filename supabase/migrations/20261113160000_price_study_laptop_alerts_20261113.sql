-- SQL99 (13 Nov 2026, Ahmed): «افتح اللابتوب» alerts for «دراسة سعر» tasks. The scheduled tasks «تسعير آلي: الأراضي» and
-- «تسعير آلي: العقارات الجاهزة» run on Ahmed's laptop (every hour, 07:00 to 23:00 Muscat time), so a property waits for as
-- long as the laptop is closed. Three alerts to his private WhatsApp, for every kind of property (his choice):
--   1. a new «دراسة سعر» task: the line «افتح اللابتوب وتطبيق Claude عشان يتسعر» is added to the report he already gets at
--      that moment (whatsapp-owner-hot-alert; no SQL here, no second alert);
--   2. two hours on, still no study handed in (no row in owner_price_studies): «العقار لسه ما تسعّر، تأكد إن اللابتوب شغال»,
--      once per task. The two hours are counted only while the scheduled task runs (07:00 to 23:00 Muscat time), and only
--      for tasks opened from 13 Nov 2026 (the older open ones get nothing);
--   3. he rejected a study (it is back in Claude's queue, «أعد الدراسة بعد المعاينة» included): the type, the area and the
--      same line as alert 1.
-- Everything here is new: no existing function, trigger or job is replaced. crm_price_study_decide, the queue, the sending
-- and the reply agent are not touched. The texts are sent by the edge function price-study (actions unpriced_tick and
-- requeue_alert) through the existing notify_owner; «once» is the applied owner_notify event with the alert's key.
-- Rollback: 99-price-study-laptop-alerts.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF to_regprocedure('crm_repair_private.price_study_kind(text, numeric)') IS NULL
     OR to_regprocedure('crm_repair_private.price_study_conversation(uuid)') IS NULL
     OR to_regprocedure('crm_repair_private.price_study_call(jsonb, integer)') IS NULL THEN
    RAISE EXCEPTION 'SQL99 refused: the SQL94 price study functions are missing';
  END IF;
END $$;

-- minutes of [p_from, p_to] that fall inside the hours the scheduled tasks run (07:00 to 23:00, Asia/Muscat)
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_run_minutes(p_from timestamptz, p_to timestamptz)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(extract(epoch from (least(p_to, w.e) - greatest(p_from, w.s))) / 60), 0)::numeric
    from generate_series((p_from at time zone 'Asia/Muscat')::date::timestamp, (p_to at time zone 'Asia/Muscat')::date::timestamp, interval '1 day') d
   cross join lateral (select ((d + time '07:00') at time zone 'Asia/Muscat') as s, ((d + time '23:00') at time zone 'Asia/Muscat') as e) w
   where least(p_to, w.e) > greatest(p_from, w.s)
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_run_minutes(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- what an alert says about a task: the branch, «أرض» or «مبنى», the type as written and the area. The chat and the owner
-- offer are found exactly as crm_price_study_queue finds them, so an alert and Claude's queue always agree on the kind.
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_brief(p_task_id uuid)
 RETURNS TABLE (task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id, t.company_id, c.route_key,
         crm_repair_private.price_study_kind(l.kind, l.built_size), l.kind, l.area, l.wilayat
    from public.tasks t
    left join public.whatsapp_conversations c on c.id = crm_repair_private.price_study_conversation(t.id)
    left join lateral (
      select o.* from public.owner_leads o
       where o.company_id = t.company_id and (o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
   where t.id = p_task_id
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_brief(uuid) FROM PUBLIC, anon, authenticated;

-- alert 2: open tasks with no study at all, two counted hours after they were opened. A task leaves the list once the
-- alert went (applied owner_notify event), once a study is handed in, or after a third counted hour (a send that keeps
-- failing is not tried all day). Nothing is due between 23:15 and 07:00.
CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()
 RETURNS TABLE (task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text, waited_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.task_id, b.company_id, b.branch, b.property_kind, b.kind_raw, b.area, b.wilayat, m.minutes::integer
    from public.tasks t
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   cross join lateral (select crm_repair_private.price_study_run_minutes(t.created_at, now()) as minutes) m
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and t.created_at >= timestamptz '2026-11-13 00:00:00+04'
     and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)
     and m.minutes >= 120 and m.minutes < 180
     and (now() at time zone 'Asia/Muscat')::time >= time '07:00'
     and (now() at time zone 'Asia/Muscat')::time < time '23:15'
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = t.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason = 'price_study_unpriced:' || t.id::text)
   order by t.created_at
   limit 10
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_unpriced_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_study_unpriced_due() TO service_role;

-- alert 3: the study Ahmed just rejected, when its task is still open, it is the task's latest version and he was not told
-- about this rejection yet. No row means no alert.
CREATE OR REPLACE FUNCTION public.crm_price_study_requeued(p_study_id uuid)
 RETURNS TABLE (study_id uuid, task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.id, b.task_id, b.company_id, coalesce(b.branch, s.route_key), b.property_kind, b.kind_raw, b.area, b.wilayat
    from public.owner_price_studies s
    join public.tasks t on t.id = s.task_id
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   where s.id = p_study_id and s.status = 'rejected'
     and t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and not exists (select 1 from public.owner_price_studies x
                      where x.task_id = s.task_id and x.status <> 'cancelled' and x.version > s.version)
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = s.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason = 'price_study_requeued:' || s.id::text)
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_requeued(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_study_requeued(uuid) TO service_role;

-- alert 3, the moment of the rejection: the edge function is asked to tell Ahmed. Never blocks his decision.
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_on_reject()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform crm_repair_private.price_study_call(jsonb_build_object('action', 'requeue_alert', 'study_id', NEW.id), 60000);
  return NEW;
exception when others then
  return NEW;
end $function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_on_reject() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_price_study_on_reject ON public.owner_price_studies;
CREATE TRIGGER crm_price_study_on_reject AFTER UPDATE OF status ON public.owner_price_studies
  FOR EACH ROW WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION crm_repair_private.price_study_on_reject();

-- alert 2, every 10 minutes, and only while a task is due: ask the edge function to tell Ahmed
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_unpriced') THEN PERFORM cron.unschedule('owner_price_study_unpriced'); END IF;
END $$;
SELECT cron.schedule('owner_price_study_unpriced', '*/10 * * * *', $job$
  select crm_repair_private.price_study_call('{"action":"unpriced_tick"}'::jsonb, 60000)
   where exists (select 1 from public.crm_price_study_unpriced_due());
$job$);
