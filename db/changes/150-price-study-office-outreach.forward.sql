-- SQL150 (21 Nov 2026, Ahmed): a study for an owner the office reached out to stays inside the office.
-- «لما الموظفة مرام تتصل على الملاك ... الدراسة مبدئيا تكون حالنا، ما نرسلها لهذيل الملاك. نشوف هل السعر اللي هو حاط لنا
-- مناسب ان نشتغل عليه ولا لا. اذا كان ما مناسب نرسل له رسالة ان عملنا دراسة وشفنا السعر غير مناسب، ونرسل له الاسعار».
--   * office_outreach: the owner came from an office call (the chat's handoff, or the «تم» that closed it, says «اتصال المكتب»).
--     Set when the study is handed in (and for the studies already open), so the screen and the send know it.
--   * owner_price: the price the owner asked for, kept on the study when it is handed in (owner_leads.price).
--   * status kept_internal: approved, the owner's price fits (≤ the office asking price, or he gave none), nothing went to
--     him; price-study closes the study task and opens «زيارة وتوقيع» instead. A price above the asking price is sent as
--     the «السعر أعلى من السوق» message the pricing run writes for these owners.
-- Rollback: 150-price-study-office-outreach.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.owner_price_studies ADD COLUMN IF NOT EXISTS office_outreach boolean NOT NULL DEFAULT false;
ALTER TABLE public.owner_price_studies ADD COLUMN IF NOT EXISTS owner_price numeric;

ALTER TABLE public.owner_price_studies DROP CONSTRAINT IF EXISTS owner_price_studies_status_check;
ALTER TABLE public.owner_price_studies ADD CONSTRAINT owner_price_studies_status_check CHECK (status = ANY (ARRAY[
  'submitted', 'files_failed', 'awaiting_approval', 'rejected', 'approved', 'sending', 'waiting_owner', 'sent', 'send_failed',
  'cancelled', 'kept_internal']));

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_office_outreach(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select c.handoff_reason ilike 'اتصال المكتب%' or c.owner_alert_done_reason ilike 'اتصال المكتب%'
                     from public.whatsapp_conversations c where c.id = p_conversation_id), false)
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_office_outreach(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_mark_outreach()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.conversation_id is not null and crm_repair_private.price_study_office_outreach(new.conversation_id) then
    new.office_outreach := true;
  end if;
  if new.owner_price is null and new.owner_lead_id is not null then
    select l.price into new.owner_price from public.owner_leads l where l.id = new.owner_lead_id;
  end if;
  return new;
end $function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_mark_outreach() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_price_study_mark_outreach ON public.owner_price_studies;
CREATE TRIGGER crm_price_study_mark_outreach BEFORE INSERT ON public.owner_price_studies
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.price_study_mark_outreach();

-- the studies still open (not sent, not cancelled)
UPDATE public.owner_price_studies s
   SET office_outreach = crm_repair_private.price_study_office_outreach(s.conversation_id),
       owner_price = coalesce(s.owner_price, (select l.price from public.owner_leads l where l.id = s.owner_lead_id))
 WHERE s.status in ('submitted', 'files_failed', 'awaiting_approval', 'rejected', 'approved', 'send_failed', 'waiting_owner');

-- the screen: office_outreach on each study, kept_internal listed for a week like a sent one
CREATE OR REPLACE FUNCTION public.crm_price_studies_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); res jsonb; v_mode text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'agent') then raise exception 'owner_only' using errcode = '42501'; end if;
  select r.price_study_send_mode into v_mode from public.whatsapp_automation_runtime r where r.company_id = v_company;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.waiting desc, x.submitted_at desc), '[]'::jsonb) into res from (
    select s.id, s.task_id, s.version, s.status, s.route_key, s.conversation_id, s.client_id,
           (s.status = 'awaiting_approval') as waiting,
           coalesce(nullif(cl.name, ''), c.customer_name, 'مالك') as owner_name, c.customer_phone as phone,
           t.title as task_title,
           crm_repair_private.price_study_kind(l.kind, l.built_size) as property_kind, l.kind as kind_raw, l.area, l.wilayat,
           coalesce(s.owner_price, l.price) as owner_price, l.land_size, l.built_size, l.plot_no,
           s.market_value, s.asking_price, s.negotiation_margin, s.owner_net, s.commission, s.owner_message,
           s.owner_report_path, s.internal_report_path, s.submitted_at, s.decided_at, s.reject_note, s.template_sent_at, s.sent_at,
           s.send_error, s.owner_reaction, s.owner_reaction_note, c.last_inbound_at, s.office_outreach,
           case when s.send_error like 'sent_by_phone%' then coalesce(nullif(pr.full_name, ''), case when s.send_error = 'sent_by_phone:echo' then 'من واتساب الفرع' end) end as sent_by_name
      from public.owner_price_studies s
      left join public.whatsapp_conversations c on c.id = s.conversation_id
      left join public.clients cl on cl.id = s.client_id
      left join public.tasks t on t.id = s.task_id
      left join public.owner_leads l on l.id = s.owner_lead_id
      left join public.profiles pr on pr.id = (case when s.send_error ~ '^sent_by_phone:[0-9a-f-]{36}$' then substr(s.send_error, 15)::uuid end)
     where s.company_id = v_company
       and (s.status in ('awaiting_approval', 'approved', 'sending', 'waiting_owner', 'send_failed')
            or (s.status in ('sent', 'kept_internal') and coalesce(s.sent_at, s.decided_at) > now() - interval '7 days')
            or (s.status = 'rejected' and s.decided_at > now() - interval '3 days'))
  ) x;
  return jsonb_build_object('items', res, 'send_mode', coalesce(v_mode, 'test'));
end $function$;
