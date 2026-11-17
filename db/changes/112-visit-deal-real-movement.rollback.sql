-- Rollback of SQL112: the closer and the home tile count the card's creation day as movement again (SQL77 / SQL111 bodies).
SET LOCAL lock_timeout = '10s';

DO $sql112rb$
DECLARE def text := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  new_part text := $n$  SELECT count(*) INTO v_n FROM public.deals d WHERE d.company_id = v_company AND d.stage IN ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
     AND d.merged_into_deal_id IS NULL AND crm_repair_private.visit_deal_last_move(d.id) < v_today - 30;$n$;
  old_part text := $o$  SELECT count(*) INTO v_n FROM public.deals d LEFT JOIN public.viewings vw ON vw.id = d.viewing_id WHERE d.company_id = v_company AND d.stage IN ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
     AND greatest(coalesce(vw.viewing_date, d.created_at::date), d.created_at::date, coalesce((SELECT max(m.message_timestamp)::date FROM public.whatsapp_messages m WHERE m.client_id = d.client_id AND m.direction = 'inbound'), d.created_at::date)) < v_today - 30;$o$;
BEGIN
  IF position(new_part IN def) = 0 THEN RAISE EXCEPTION 'SQL112 rollback refused: the SQL112 statement is not in crm_owner_home'; END IF;
  EXECUTE replace(def, new_part, old_part);
END $sql112rb$;

CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int := 0;
begin
  -- SQL77: the reason is looked up per deal company and must be active (no reason, no closing); merged duplicate
  -- cards are skipped; a card that absorbed a merged duplicate is as recent as the newest card merged into it.
  with stale as (
    select d.id, d.stage, rr.id as rid from public.deals d
      join public.rejection_reasons rr on rr.company_id = d.company_id and rr.code = 'no_response_after_visit' and rr.is_active is true
      left join public.viewings v on v.id = d.viewing_id
     where d.stage in ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
       and d.merged_into_deal_id is null
       and greatest(
             coalesce(v.viewing_date, d.created_at::date),
             d.created_at::date,
             coalesce((select max(md.created_at)::date from public.deals md where md.merged_into_deal_id = d.id), d.created_at::date),
             coalesce((select max(m.message_timestamp)::date from public.whatsapp_messages m where m.client_id = d.client_id and m.direction='inbound'), d.created_at::date)
           ) < (now() at time zone 'Asia/Muscat')::date - p_days
  ), upd as (
    update public.deals d set stage='lost', lost_from_stage=s.stage, lost_at=now(), lost_reason_id=s.rid,
           lost_reason_note='تلقائي: الصفقة واقفة على الزيارة أكثر من 3 أشهر بدون تواصل أو تقدم', updated_at=now()
      from stale s where d.id=s.id and d.merged_into_deal_id is null returning d.id)
  select count(*) into n from upd;
  return n;
end $function$;

DROP FUNCTION IF EXISTS crm_repair_private.visit_deal_last_move(uuid);
