-- SQL141 (18 Nov 2026, Ahmed: «إيوا صلح التنبيه»). The two pricing routines now run twice a day only (08:07/08:12 and
-- 14:07/14:12 Muscat, Ahmed's change of 18 Nov). The «⏰ العقار لسه ما تسعّر» alert (SQL99/SQL134) fired 2 hours after the
-- task opened, which assumed hourly runs. Now it fires only when the first pricing run after the task opened has passed
-- (08:00 or 14:00 Muscat) plus 2 hours for the study, and the task still has no study. Still once per task, sent 05:00–21:15.
-- Same function name, arguments and columns (waited_minutes = minutes since the task opened).
-- Rollback: 141-unpriced-after-run.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_first_run(p_at timestamptz)
 RETURNS timestamptz LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  select case
    when (p_at at time zone 'Asia/Muscat')::time < time '08:00' then ((p_at at time zone 'Asia/Muscat')::date + time '08:00') at time zone 'Asia/Muscat'
    when (p_at at time zone 'Asia/Muscat')::time < time '14:00' then ((p_at at time zone 'Asia/Muscat')::date + time '14:00') at time zone 'Asia/Muscat'
    else ((p_at at time zone 'Asia/Muscat')::date + 1 + time '08:00') at time zone 'Asia/Muscat'
  end
$function$;

CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()
 RETURNS TABLE(task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text, waited_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.task_id, b.company_id, b.branch, b.property_kind, b.kind_raw, b.area, b.wilayat,
         (extract(epoch from (now() - t.created_at)) / 60)::integer
    from public.tasks t
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and t.created_at >= greatest(timestamptz '2026-11-13 00:00:00+04', now() - interval '3 days')
     and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)
     -- tasks opened before the schedule change (18 Nov 14:30) count from it, so the change itself sends no burst
     and now() >= crm_repair_private.price_study_first_run(greatest(t.created_at, timestamptz '2026-11-18 14:30:00+04')) + interval '2 hours'
     and (now() at time zone 'Asia/Muscat')::time >= time '05:00'
     and (now() at time zone 'Asia/Muscat')::time < time '21:15'
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = t.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason = 'price_study_unpriced:' || t.id::text)
   order by t.created_at
   limit 10
$function$;
