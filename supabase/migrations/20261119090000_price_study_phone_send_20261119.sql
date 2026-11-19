-- SQL146 (19 Nov 2026, Ahmed): a study can go from the phone's WhatsApp at any point, by the owner or a staff member.
--   1. «تم الإرسال» works on a study still waiting for approval too (it counts as approved and sent by whoever pressed it).
--   2. The system sees it by itself: when the branch number's WhatsApp Business app sends that chat a PDF, or the study's
--      message, after the study was handed in, the study is closed as sent from the phone (echo of the app, SQL146 trigger).
--   3. The list says who sent it from the phone (sent_by_name), and the home count and the tabs count the same thing.
-- The message and the PDF are the ones Claude made; nothing about them changes. Rollback: 146-price-study-phone-send.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_price_study_sent_by_phone(p_study_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid := auth.uid(); c uuid := public.my_company(); st text;
BEGIN
  IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501';
  END IF;
  SELECT s.status INTO st FROM public.owner_price_studies s WHERE s.id = p_study_id AND s.company_id = c;
  IF st IS NULL THEN RAISE EXCEPTION 'study_not_found' USING ERRCODE = '22023'; END IF;
  IF st NOT IN ('awaiting_approval', 'waiting_owner', 'approved', 'send_failed') THEN RAISE EXCEPTION 'study_not_waiting' USING ERRCODE = '22023'; END IF;
  PERFORM crm_repair_private.price_study_call(jsonb_build_object('action', 'sent_by_phone', 'study_id', p_study_id, 'by', u));
  RETURN jsonb_build_object('ok', true, 'study_id', p_study_id);
END $function$;

-- the branch app sent the owner the PDF or the study's message: the study is closed as sent from the phone
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_on_echo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s record; norm text;
BEGIN
  IF NEW.direction <> 'outbound' OR coalesce(NEW.channel_source, '') <> 'whatsapp_business_app' OR NEW.conversation_id IS NULL
     OR NEW.message_type NOT IN ('document', 'text') THEN RETURN NEW; END IF;
  BEGIN
    norm := regexp_replace(coalesce(NEW.body, ''), '\s+', ' ', 'g');
    FOR s IN
      SELECT p.id, p.owner_message FROM public.owner_price_studies p
       WHERE p.conversation_id = NEW.conversation_id
         AND p.status IN ('awaiting_approval', 'approved', 'waiting_owner', 'send_failed')
         AND p.submitted_at < coalesce(NEW.message_timestamp, now())
       ORDER BY p.submitted_at DESC LIMIT 1
    LOOP
      IF (NEW.message_type = 'document' AND lower(coalesce(NEW.raw_payload #>> '{document,mime_type}', '')) = 'application/pdf')
         OR (NEW.message_type = 'text' AND length(trim(coalesce(s.owner_message, ''))) >= 30
             AND position(left(regexp_replace(trim(s.owner_message), '\s+', ' ', 'g'), 40) in norm) > 0) THEN
        PERFORM crm_repair_private.price_study_call(jsonb_build_object('action', 'sent_by_phone', 'study_id', s.id, 'via', 'echo'), 60000);
      END IF;
    END LOOP;
  EXCEPTION WHEN others THEN NULL; -- a message is never held back by this
  END;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_on_echo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_price_study_on_echo ON public.whatsapp_messages;
CREATE TRIGGER crm_price_study_on_echo AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.price_study_on_echo();

-- the list: who sent it from the phone
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
           l.price as owner_price, l.land_size, l.built_size, l.plot_no,
           s.market_value, s.asking_price, s.negotiation_margin, s.owner_net, s.commission, s.owner_message,
           s.owner_report_path, s.internal_report_path, s.submitted_at, s.decided_at, s.reject_note, s.template_sent_at, s.sent_at,
           s.send_error, s.owner_reaction, s.owner_reaction_note, c.last_inbound_at,
           case when s.send_error like 'sent_by_phone%' then coalesce(nullif(pr.full_name, ''), case when s.send_error = 'sent_by_phone:echo' then 'من واتساب الفرع' end) end as sent_by_name
      from public.owner_price_studies s
      left join public.whatsapp_conversations c on c.id = s.conversation_id
      left join public.clients cl on cl.id = s.client_id
      left join public.tasks t on t.id = s.task_id
      left join public.owner_leads l on l.id = s.owner_lead_id
      -- the person who pressed «تم الإرسال» is written in send_error (sent_by_phone:<user id>) by the price-study function
      left join public.profiles pr on pr.id = (case when s.send_error ~ '^sent_by_phone:[0-9a-f-]{36}$' then substr(s.send_error, 15)::uuid end)
     where s.company_id = v_company
       and (s.status in ('awaiting_approval', 'approved', 'sending', 'waiting_owner', 'send_failed')
            or (s.status = 'sent' and s.sent_at > now() - interval '7 days')
            or (s.status = 'rejected' and s.decided_at > now() - interval '3 days'))
  ) x;
  return jsonb_build_object('items', res, 'send_mode', coalesce(v_mode, 'test'));
end $function$;

-- settings the edge functions read with the service role (the Drive uploader of price-study: its address and key)
CREATE TABLE IF NOT EXISTS public.crm_service_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_service_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_service_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_service_settings TO service_role;
