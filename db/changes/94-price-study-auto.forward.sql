-- SQL94 (11 Nov 2026, Ahmed): automatic price studies. Claude (pricing projects, a scheduled task with SQL access only) reads
-- the open «دراسة سعر» tasks, the owner's saved documents and the chat, and hands a study back: market value, asking price,
-- negotiation margin, owner net, commission, the message for the owner and two PDF reports (Google Drive file ids, pulled
-- into a private bucket by the edge function price-study). Ahmed approves or rejects each study on the CRM (owner only);
-- only after his approval the message and the owner report go to the owner from the branch number, the task closes and
-- the owner offer becomes «studied». Owner net, commission and the internal report are owner-only (RLS, no staff policy).
-- Sending to owners starts in mode «test» (only the test numbers in whatsapp_automation_runtime.allowed_customer_phones).
-- Rollback: 94-price-study-auto.rollback.sql
SET LOCAL lock_timeout = '10s';

-- 1. the switch: off | test (only the runtime test numbers) | live
ALTER TABLE public.whatsapp_automation_runtime ADD COLUMN IF NOT EXISTS price_study_send_mode text NOT NULL DEFAULT 'test';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runtime_price_study_send_mode_chk') THEN
    ALTER TABLE public.whatsapp_automation_runtime ADD CONSTRAINT runtime_price_study_send_mode_chk
      CHECK (price_study_send_mode IN ('off', 'test', 'live'));
  END IF;
END $$;

-- 2. the studies (owner only)
CREATE TABLE IF NOT EXISTS public.owner_price_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  owner_lead_id uuid REFERENCES public.owner_leads(id) ON DELETE SET NULL,
  route_key text,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'files_failed', 'awaiting_approval', 'rejected', 'approved', 'sending', 'waiting_owner', 'sent', 'send_failed', 'cancelled')),
  market_value numeric NOT NULL,
  asking_price numeric NOT NULL,
  negotiation_margin numeric NOT NULL,
  owner_net numeric NOT NULL,
  commission numeric NOT NULL,
  owner_message text NOT NULL,
  owner_report_drive_id text NOT NULL,
  internal_report_drive_id text NOT NULL,
  owner_report_path text,
  internal_report_path text,
  files_error text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reject_note text,
  template_sent_at timestamptz,
  owner_message_wamid text,
  owner_report_wamid text,
  sent_at timestamptz,
  send_error text,
  owner_reaction text CHECK (owner_reaction IS NULL OR owner_reaction IN ('accepted', 'price_rejected', 'counter_offer')),
  owner_reaction_note text,
  owner_reaction_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, version)
);
-- one study in flight per task (a rejected or cancelled one makes room for the next version)
CREATE UNIQUE INDEX IF NOT EXISTS owner_price_studies_one_active ON public.owner_price_studies(task_id)
  WHERE status NOT IN ('rejected', 'cancelled', 'files_failed');
CREATE INDEX IF NOT EXISTS owner_price_studies_conv_idx ON public.owner_price_studies(conversation_id, status);
CREATE INDEX IF NOT EXISTS owner_price_studies_status_idx ON public.owner_price_studies(company_id, status, submitted_at DESC);

ALTER TABLE public.owner_price_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_price_studies_owner_read ON public.owner_price_studies;
CREATE POLICY owner_price_studies_owner_read ON public.owner_price_studies FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.owner_price_studies FROM anon, authenticated;
GRANT SELECT ON public.owner_price_studies TO authenticated;
GRANT ALL ON public.owner_price_studies TO service_role;

-- 3. a copy of what the owner sent (kroki, title deed, photos), kept because Meta drops media after about two weeks
CREATE TABLE IF NOT EXISTS public.owner_price_study_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  message_type text NOT NULL,
  mime text,
  filename text,
  caption text,
  size_bytes bigint,
  storage_path text,
  status text NOT NULL CHECK (status IN ('saved', 'expired', 'too_big', 'failed')),
  error text,
  message_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_price_study_docs_conv_idx ON public.owner_price_study_docs(conversation_id, message_timestamp);

ALTER TABLE public.owner_price_study_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_price_study_docs_owner_read ON public.owner_price_study_docs;
CREATE POLICY owner_price_study_docs_owner_read ON public.owner_price_study_docs FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.owner_price_study_docs FROM anon, authenticated;
GRANT SELECT ON public.owner_price_study_docs TO authenticated;
GRANT ALL ON public.owner_price_study_docs TO service_role;

-- 4. the private bucket: docs/<conversation>/<message>.<ext> and reports/<study>/{owner,internal}.pdf. The owner reads; nobody
-- else has a policy (the edge function writes with the service key).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('price-studies', 'price-studies', false, 20971520)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS crm_price_studies_owner_read ON storage.objects;
CREATE POLICY crm_price_studies_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'price-studies' AND (SELECT public.my_role()) = 'owner');

-- 5. helpers
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_call(p_body jsonb, p_timeout integer DEFAULT 150000)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/price-study',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'crm_reply_agent')),
    body := p_body,
    timeout_milliseconds := p_timeout);
end $function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_call(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- «أرض» or «مبنى» from the many spellings in owner_leads.kind (land, أرض سكنية, villa, بيت …). A farm with no building is land.
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_kind(p_kind text, p_built numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce(p_kind, '') ~* '^\s*(land|plot)\s*$' or coalesce(p_kind, '') ~ '^\s*(أرض|ارض|قطعة)' then 'أرض'
    when (coalesce(p_kind, '') ~* '^\s*farm\s*$' or coalesce(p_kind, '') ~ '^\s*مزرع') and coalesce(p_built, 0) = 0 then 'أرض'
    when coalesce(p_kind, '') = '' and coalesce(p_built, 0) = 0 then 'أرض'
    else 'مبنى' end
$function$;

-- the chat of a price study task: the one held for «دراسة سعر» first, else the owner's latest chat on a branch number
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_conversation(p_task_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id
    from public.tasks t
    join public.whatsapp_conversations c on c.company_id = t.company_id and c.client_id = t.client_id
   where t.id = p_task_id and t.client_id is not null and c.route_key in ('barka', 'muscat')
   order by (c.human_handoff_required and coalesce(c.handoff_reason, '') ~ '^\s*دراسة\s*سعر') desc, c.last_inbound_at desc nulls last
   limit 1
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.price_study_conversation(uuid) FROM PUBLIC, anon, authenticated;

-- 6. for Claude: the open price study tasks with no study handed in (or one Ahmed rejected, with his note)
CREATE OR REPLACE FUNCTION public.crm_price_study_queue()
 RETURNS TABLE (task_id uuid, state text, reject_note text, files_error text, next_version integer, task_title text, task_notes text,
                task_created_at timestamptz, branch text, conversation_id uuid, owner_name text, property_kind text, kind_raw text,
                area text, wilayat text, owner_price numeric, land_size numeric, built_size numeric, plot_no text, offer_notes text,
                owner_lead_id uuid, chat_summary text, docs_saved integer, docs_not_saved integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id,
         case when s.id is null then 'new' when s.status = 'rejected' then 'rejected' else 'files_failed' end,
         case when s.status = 'rejected' then s.reject_note end,
         case when s.status = 'files_failed' then s.files_error end,
         coalesce(s.version, 0) + 1,
         t.title, t.notes, t.created_at, c.route_key, c.id,
         coalesce(nullif(cl.name, ''), c.customer_name),
         crm_repair_private.price_study_kind(l.kind, l.built_size), l.kind,
         l.area, l.wilayat, l.price, l.land_size, l.built_size, l.plot_no, l.notes, l.id,
         coalesce(c.agent_note, c.ai_summary),
         (select count(*)::int from public.owner_price_study_docs d where d.conversation_id = c.id and d.status = 'saved'),
         (select count(*)::int from public.whatsapp_messages m
           where m.conversation_id = c.id and m.direction = 'inbound' and m.message_type in ('image', 'document', 'video') and m.media_id is not null
             and not exists (select 1 from public.owner_price_study_docs d where d.message_id = m.id and d.status = 'saved'))
    from public.tasks t
    left join public.clients cl on cl.id = t.client_id
    left join public.whatsapp_conversations c on c.id = crm_repair_private.price_study_conversation(t.id)
    left join lateral (
      select o.* from public.owner_leads o
       where o.company_id = t.company_id and (o.conversation_id = c.id or o.client_id = t.client_id)
       order by (o.conversation_id = c.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc
       limit 1) l on true
    left join lateral (
      select x.* from public.owner_price_studies x where x.task_id = t.id and x.status <> 'cancelled'
       order by x.version desc limit 1) s on true
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and (s.id is null or s.status in ('rejected', 'files_failed'))
   order by t.created_at
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_queue() FROM PUBLIC, anon, authenticated;

-- the owner's saved documents of a task, each with a link that works for 6 hours (signed by the edge function)
CREATE OR REPLACE FUNCTION public.crm_price_study_documents(p_task_id uuid)
 RETURNS TABLE (sent_at timestamptz, kind text, filename text, mime text, size_bytes bigint, caption text, doc_status text, url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conv uuid; v_secret text; r record; j jsonb;
begin
  v_conv := crm_repair_private.price_study_conversation(p_task_id);
  if v_conv is null then raise exception 'conversation_not_found_for_task'; end if;
  select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name = 'crm_reply_agent';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
  select h.status as http_status, h.content as http_content into r
    from extensions.http(('POST', 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/price-study',
           ARRAY[extensions.http_header('x-crm-agent', v_secret)], 'application/json',
           jsonb_build_object('action', 'sign', 'conversation_id', v_conv)::text)::extensions.http_request) h;
  if r.http_status <> 200 then raise exception 'sign_failed: % %', r.http_status, left(r.http_content, 200); end if;
  j := r.http_content::jsonb;
  return query
    select (d ->> 'sent_at')::timestamptz, d ->> 'kind', d ->> 'filename', d ->> 'mime', (d ->> 'size')::bigint, d ->> 'caption', d ->> 'status', d ->> 'url'
      from jsonb_array_elements(coalesce(j -> 'documents', '[]'::jsonb)) d
     order by 1;
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_documents(uuid) FROM PUBLIC, anon, authenticated;

-- the chat of a task as text: the owner's words (voice notes as their transcript) and what the office answered
CREATE OR REPLACE FUNCTION public.crm_price_study_chat(p_task_id uuid)
 RETURNS TABLE (sent_at timestamptz, who text, kind text, content text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.message_timestamp, case m.direction when 'inbound' then 'المالك' else 'المكتب' end, m.message_type,
         coalesce(nullif(m.transcript, ''), m.body)
    from public.whatsapp_messages m
   where m.conversation_id = crm_repair_private.price_study_conversation(p_task_id)
     and m.direction in ('inbound', 'outbound')
     and m.message_timestamp > now() - interval '90 days'
     and (coalesce(nullif(m.transcript, ''), m.body) is not null or m.message_type in ('image', 'document', 'video', 'location'))
   order by m.message_timestamp
   limit 500
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_chat(uuid) FROM PUBLIC, anon, authenticated;

-- Claude hands the study in. The two PDFs are Google Drive files shared «anyone with the link»; a file id or a whole Drive
-- link is accepted. The edge function copies them into the private bucket within a minute, then Ahmed is told.
CREATE OR REPLACE FUNCTION public.crm_price_study_submit(
  p_task_id uuid, p_market_value numeric, p_asking_price numeric, p_negotiation_margin numeric, p_owner_net numeric,
  p_commission numeric, p_owner_message text, p_owner_report_drive_id text, p_internal_report_drive_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t record; v_conv record; v_lead uuid; v_last record; v_id uuid; v_ver integer; v_owner text; v_internal text; v_msg text;
begin
  select x.id, x.company_id, x.client_id, x.title, x.done into t from public.tasks x where x.id = p_task_id;
  if not found then raise exception 'task_not_found'; end if;
  if t.title not ilike 'دراسة سعر%' then raise exception 'not_a_price_study_task'; end if;
  if coalesce(t.done, false) then raise exception 'task_already_done'; end if;
  if coalesce(p_market_value, 0) <= 0 or coalesce(p_asking_price, 0) <= 0 or p_negotiation_margin is null or p_negotiation_margin < 0
     or coalesce(p_owner_net, 0) <= 0 or p_commission is null or p_commission < 0 then
    raise exception 'numbers_required: market_value, asking_price, owner_net above zero; negotiation_margin and commission zero or more (OMR)';
  end if;
  v_msg := btrim(coalesce(p_owner_message, ''));
  if length(v_msg) < 20 or length(v_msg) > 3500 then raise exception 'owner_message_must_be_20_to_3500_characters'; end if;
  v_owner := coalesce(substring(p_owner_report_drive_id from '(?:/d/|[?&]id=)([A-Za-z0-9_-]{20,})'), btrim(p_owner_report_drive_id));
  v_internal := coalesce(substring(p_internal_report_drive_id from '(?:/d/|[?&]id=)([A-Za-z0-9_-]{20,})'), btrim(p_internal_report_drive_id));
  if coalesce(v_owner, '') !~ '^[A-Za-z0-9_-]{20,}$' or coalesce(v_internal, '') !~ '^[A-Za-z0-9_-]{20,}$' then
    raise exception 'drive_file_ids_required';
  end if;
  if v_owner = v_internal then raise exception 'the_two_reports_must_be_different_files'; end if;

  select x.id, x.version, x.status into v_last from public.owner_price_studies x
   where x.task_id = p_task_id and x.status <> 'cancelled' order by x.version desc limit 1 for update;
  if found and v_last.status not in ('rejected', 'files_failed') then
    raise exception 'study_already_handed_in: version % is %', v_last.version, v_last.status;
  end if;
  v_ver := coalesce(v_last.version, 0) + 1;

  select c.id, c.route_key into v_conv from public.whatsapp_conversations c where c.id = crm_repair_private.price_study_conversation(p_task_id);
  if v_conv.id is null then raise exception 'conversation_not_found_for_task'; end if;
  select o.id into v_lead from public.owner_leads o
   where o.company_id = t.company_id and (o.conversation_id = v_conv.id or o.client_id = t.client_id)
   order by (o.conversation_id = v_conv.id) desc nulls last, (o.source_request_id is null) desc, o.created_at desc limit 1;

  insert into public.owner_price_studies (company_id, task_id, client_id, conversation_id, owner_lead_id, route_key, version, status,
      market_value, asking_price, negotiation_margin, owner_net, commission, owner_message, owner_report_drive_id, internal_report_drive_id)
    values (t.company_id, p_task_id, t.client_id, v_conv.id, v_lead, v_conv.route_key, v_ver, 'submitted',
      p_market_value, p_asking_price, p_negotiation_margin, p_owner_net, p_commission, v_msg, v_owner, v_internal)
    returning id into v_id;
  perform crm_repair_private.price_study_call(jsonb_build_object('action', 'pull_files', 'study_id', v_id));
  return jsonb_build_object('ok', true, 'study_id', v_id, 'version', v_ver, 'status', 'submitted',
    'next', 'check crm_price_study_status after one minute: awaiting_approval means the files were copied, files_failed carries the reason');
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text) FROM PUBLIC, anon, authenticated;

-- where a task's studies stand (for Claude after handing in, and to see Ahmed's decision)
CREATE OR REPLACE FUNCTION public.crm_price_study_status(p_task_id uuid)
 RETURNS TABLE (study_id uuid, version integer, study_status text, files_error text, reject_note text, send_error text,
                submitted_at timestamptz, decided_at timestamptz, sent_at timestamptz, owner_reaction text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.id, s.version, s.status, s.files_error, s.reject_note, s.send_error, s.submitted_at, s.decided_at, s.sent_at, s.owner_reaction
    from public.owner_price_studies s where s.task_id = p_task_id order by s.version desc
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_status(uuid) FROM PUBLIC, anon, authenticated;

-- 7. for Ahmed's screen (owner only): what waits for him, and what was decided lately
CREATE OR REPLACE FUNCTION public.crm_price_studies_pending()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := public.my_company(); res jsonb; v_mode text;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
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
           s.send_error, s.owner_reaction, s.owner_reaction_note, c.last_inbound_at
      from public.owner_price_studies s
      left join public.whatsapp_conversations c on c.id = s.conversation_id
      left join public.clients cl on cl.id = s.client_id
      left join public.tasks t on t.id = s.task_id
      left join public.owner_leads l on l.id = s.owner_lead_id
     where s.company_id = v_company
       and (s.status in ('awaiting_approval', 'approved', 'sending', 'waiting_owner', 'send_failed')
            or (s.status = 'sent' and s.sent_at > now() - interval '7 days')
            or (s.status = 'rejected' and s.decided_at > now() - interval '3 days'))
  ) x;
  return jsonb_build_object('items', res, 'send_mode', coalesce(v_mode, 'test'));
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_studies_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_studies_pending() TO authenticated;

-- «موافق» (the message may be edited first) or «رفض مع ملاحظة» (the note goes back to Claude with the task)
CREATE OR REPLACE FUNCTION public.crm_price_study_decide(p_study_id uuid, p_approve boolean, p_note text DEFAULT NULL, p_owner_message text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; v_msg text; v_note text;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
  select x.id, x.status into s from public.owner_price_studies x
   where x.id = p_study_id and x.company_id = public.my_company() for update;
  if not found then raise exception 'study_not_found'; end if;
  if s.status not in ('awaiting_approval', 'approved', 'send_failed') then raise exception 'study_not_waiting: %', s.status; end if;
  if p_approve then
    v_msg := nullif(btrim(coalesce(p_owner_message, '')), '');
    if v_msg is not null and (length(v_msg) < 20 or length(v_msg) > 3500) then raise exception 'owner_message_must_be_20_to_3500_characters'; end if;
    update public.owner_price_studies x
       set status = 'approved', decided_at = now(), decided_by = (select auth.uid()), owner_message = coalesce(v_msg, x.owner_message),
           send_error = null, updated_at = now()
     where x.id = s.id;
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'send', 'study_id', s.id));
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;
  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) < 3 then raise exception 'reject_note_required'; end if;
  update public.owner_price_studies x
     set status = 'rejected', decided_at = now(), decided_by = (select auth.uid()), reject_note = left(v_note, 2000), updated_at = now()
   where x.id = s.id;
  return jsonb_build_object('ok', true, 'status', 'rejected');
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_decide(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_price_study_decide(uuid, boolean, text, text) TO authenticated;

-- 8. triggers. A new «دراسة سعر» handoff saves everything the owner sent so far; while the study is open every new image or
-- document is saved as it arrives; an owner who answers after the approval gets the study (template path) or his answer is read.
CREATE OR REPLACE FUNCTION crm_repair_private.price_study_on_handoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if NEW.route_key in ('barka', 'muscat') and NEW.human_handoff_required
     and coalesce(NEW.handoff_reason, '') ~ '^\s*دراسة\s*سعر'
     and (not coalesce(OLD.human_handoff_required, false) or coalesce(OLD.handoff_reason, '') !~ '^\s*دراسة\s*سعر') then
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'save_docs', 'conversation_id', NEW.id));
  end if;
  return NEW;
exception when others then
  return NEW;
end $function$;
DROP TRIGGER IF EXISTS crm_price_study_on_handoff ON public.whatsapp_conversations;
CREATE TRIGGER crm_price_study_on_handoff AFTER UPDATE OF human_handoff_required, handoff_reason ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.price_study_on_handoff();

CREATE OR REPLACE FUNCTION crm_repair_private.price_study_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if NEW.direction <> 'inbound' or NEW.conversation_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and not (NEW.transcript is not null and OLD.transcript is null) then return NEW; end if;
  if exists (select 1 from public.owner_price_studies s
              where s.conversation_id = NEW.conversation_id
                and (s.status = 'waiting_owner'
                     or (s.status = 'sent' and s.owner_reaction is null and s.sent_at > now() - interval '14 days'))) then
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'owner_inbound', 'conversation_id', NEW.conversation_id, 'message_id', NEW.id));
  elsif TG_OP = 'INSERT' and NEW.message_type in ('image', 'document', 'video') and NEW.media_id is not null
     and exists (select 1 from public.whatsapp_conversations c
                  where c.id = NEW.conversation_id and c.human_handoff_required and coalesce(c.handoff_reason, '') ~ '^\s*دراسة\s*سعر') then
    perform crm_repair_private.price_study_call(jsonb_build_object('action', 'save_docs', 'conversation_id', NEW.conversation_id));
  end if;
  return NEW;
exception when others then
  return NEW; -- never block message saving
end $function$;
DROP TRIGGER IF EXISTS crm_price_study_on_message ON public.whatsapp_messages;
CREATE TRIGGER crm_price_study_on_message AFTER INSERT OR UPDATE OF transcript ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.price_study_on_message();
