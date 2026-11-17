-- SQL112 (17 Nov 2026, Ahmed: «نعم، صلّحه»). The automatic close of visit deals after 3 months (crm_close_stale_visit_deals, SQL77) and the
-- home tile «صفقات زيارة بدون أي حركة من شهر» counted the day a card was CREATED as movement: a legacy card made on 13 Sep from a June visit
-- would only close on 12 Dec, and a card that absorbed a duplicate made on 5 Nov in February.
-- One rule now, crm_repair_private.visit_deal_last_move(deal): the latest of
--   the visit date (the creation day only when the card has no visit), the same for every card merged into it,
--   the client's last WhatsApp message to us, and the last activity a person recorded on the client (a call, a note).
-- Both the closer and the home tile use it. On 17 Nov no open visit deal is past 30 days under this rule, so nothing closes at once.
-- The closer keeps its reason (no_response_after_visit), its note and its 90 days. Rollback: 112-visit-deal-real-movement.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_close_stale_visit_deals(integer)'::regprocedure)) <> '84fade95a6d5c387847b6cea0e18c275' THEN
    RAISE EXCEPTION 'SQL112 refused: crm_close_stale_visit_deals changed since 17 Nov 2026, read it again first';
  END IF;
  IF md5(pg_get_functiondef('public.crm_owner_home()'::regprocedure)) <> '63b3617e705873462cf2baa3c37e121d' THEN
    RAISE EXCEPTION 'SQL112 refused: crm_owner_home changed since SQL111, read it again first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION crm_repair_private.visit_deal_last_move(p_deal uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT greatest(
           coalesce(v.viewing_date, d.created_at::date),
           (SELECT max(coalesce(mv.viewing_date, md.created_at::date)) FROM public.deals md LEFT JOIN public.viewings mv ON mv.id = md.viewing_id
             WHERE md.merged_into_deal_id = d.id),
           (SELECT max(m.message_timestamp)::date FROM public.whatsapp_messages m WHERE m.client_id = d.client_id AND m.direction = 'inbound'),
           (SELECT max(a.occurred_at)::date FROM public.activities a WHERE a.client_id = d.client_id AND a.company_id = d.company_id AND a.actor_type = 'human'))
    FROM public.deals d LEFT JOIN public.viewings v ON v.id = d.viewing_id
   WHERE d.id = p_deal;
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.visit_deal_last_move(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int := 0;
begin
  -- SQL77: the reason is looked up per deal company and must be active (no reason, no closing); merged duplicate cards are skipped.
  -- SQL112: movement = crm_repair_private.visit_deal_last_move (visit dates, the client's messages, a person's activity), never the
  -- day a card was created when it has a visit.
  with stale as (
    select d.id, d.stage, rr.id as rid from public.deals d
      join public.rejection_reasons rr on rr.company_id = d.company_id and rr.code = 'no_response_after_visit' and rr.is_active is true
     where d.stage in ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
       and d.merged_into_deal_id is null
       and crm_repair_private.visit_deal_last_move(d.id) < (now() at time zone 'Asia/Muscat')::date - p_days
  ), upd as (
    update public.deals d set stage='lost', lost_from_stage=s.stage, lost_at=now(), lost_reason_id=s.rid,
           lost_reason_note='تلقائي: الصفقة واقفة على الزيارة أكثر من 3 أشهر بدون تواصل أو تقدم', updated_at=now()
      from stale s where d.id=s.id and d.merged_into_deal_id is null returning d.id)
  select count(*) into n from upd;
  return n;
end $function$;

DO $sql112$
DECLARE def text := pg_get_functiondef('public.crm_owner_home()'::regprocedure);
  old_part text := $o$  SELECT count(*) INTO v_n FROM public.deals d LEFT JOIN public.viewings vw ON vw.id = d.viewing_id WHERE d.company_id = v_company AND d.stage IN ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
     AND greatest(coalesce(vw.viewing_date, d.created_at::date), d.created_at::date, coalesce((SELECT max(m.message_timestamp)::date FROM public.whatsapp_messages m WHERE m.client_id = d.client_id AND m.direction = 'inbound'), d.created_at::date)) < v_today - 30;$o$;
  new_part text := $n$  SELECT count(*) INTO v_n FROM public.deals d WHERE d.company_id = v_company AND d.stage IN ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
     AND d.merged_into_deal_id IS NULL AND crm_repair_private.visit_deal_last_move(d.id) < v_today - 30;$n$;
BEGIN
  IF position(old_part IN def) = 0 THEN RAISE EXCEPTION 'SQL112 refused: the stale-deals statement of crm_owner_home is not where expected'; END IF;
  EXECUTE replace(def, old_part, new_part);
END $sql112$;
