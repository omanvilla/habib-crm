-- Copied as they are from the live database on 5 Nov 2026 (supabase_migrations.schema_migrations and cron.job).
-- These were applied directly and never reached the repo. All already applied: a record, not something to run again.
-- Not repeated here: owner_leads_matching (4 Nov), replaced twice by the two match functions below;
-- changes already recorded in the other db/changes/20261104_* and 20261105_* files.

-- ===== 20261101045344_reply_agent_v1_schema =====
-- 1) How each property can be visited
alter table public.properties
  add column if not exists visit_method text,
  add column if not exists visit_instructions text,
  add column if not exists lockbox_image_url text;
alter table public.properties drop constraint if exists properties_visit_method_chk;
alter table public.properties add constraint properties_visit_method_chk
  check (visit_method is null or visit_method in ('open','lockbox','owner_lives','office'));

-- 2) Reply-agent switches on the runtime row
alter table public.whatsapp_automation_runtime
  add column if not exists reply_agent_mode text not null default 'off',
  add column if not exists approver_phone text;
alter table public.whatsapp_automation_runtime drop constraint if exists runtime_reply_agent_mode_chk;
alter table public.whatsapp_automation_runtime add constraint runtime_reply_agent_mode_chk
  check (reply_agent_mode in ('off','direct','approval'));

-- 3) Every reply the agent writes (sent or waiting approval)
create table if not exists public.whatsapp_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid not null,
  client_id uuid,
  analysis jsonb not null default '{}'::jsonb,
  reply_messages text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','sent','approved','edited','rejected','skipped','failed')),
  approver_note text,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  sent_at timestamptz
);
create unique index if not exists whatsapp_reply_drafts_message_uq on public.whatsapp_reply_drafts(message_id);
create index if not exists whatsapp_reply_drafts_conv_idx on public.whatsapp_reply_drafts(conversation_id, created_at desc);

-- 4) Replies the owner approved/edited become fixed rules the agent follows
create table if not exists public.whatsapp_reply_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  situation text not null,
  approved_reply text not null,
  source_draft_id uuid references public.whatsapp_reply_drafts(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_reply_drafts enable row level security;
alter table public.whatsapp_reply_rules enable row level security;
drop policy if exists reply_drafts_company_read on public.whatsapp_reply_drafts;
create policy reply_drafts_company_read on public.whatsapp_reply_drafts for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id = whatsapp_reply_drafts.company_id));
drop policy if exists reply_rules_company_read on public.whatsapp_reply_rules;
create policy reply_rules_company_read on public.whatsapp_reply_rules for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id = whatsapp_reply_rules.company_id));

-- 5) Shared secret so only the database can wake the agent
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'crm_reply_agent') then
    perform vault.create_secret(encode(gen_random_bytes(24),'hex'), 'crm_reply_agent');
  end if;
end $$;

create or replace function public.crm_reply_agent_secret_ok(p_secret text)
returns boolean language sql security definer set search_path to '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'crm_reply_agent' and decrypted_secret = p_secret);
$$;
revoke all on function public.crm_reply_agent_secret_ok(text) from public, anon, authenticated;
grant execute on function public.crm_reply_agent_secret_ok(text) to service_role;

-- 6) Wake the agent on each inbound message (only when switched on and the phone is allowed)
create or replace function crm_repair_private.wake_reply_agent()
returns trigger language plpgsql security definer set search_path to '' as $$
declare rt record; phone text; secret text;
begin
  if NEW.direction <> 'inbound' or NEW.client_id is null or NEW.conversation_id is null then return NEW; end if;
  select reply_agent_mode, allowed_customer_phones, mode into rt
    from public.whatsapp_automation_runtime where company_id = NEW.company_id;
  if rt is null or rt.reply_agent_mode = 'off' then return NEW; end if;
  select regexp_replace(coalesce(c.phone_normalized, c.phone, ''), '\D', '', 'g') into phone
    from public.clients c where c.id = NEW.client_id;
  -- never react to the company's own numbers
  if exists (select 1 from public.company_lead_routes r
             where regexp_replace(coalesce(r.whatsapp_number,''), '\D', '', 'g') = phone and phone <> '') then
    return NEW;
  end if;
  if rt.mode = 'test' and not (phone = any (
       select regexp_replace(x, '\D', '', 'g') from unnest(coalesce(rt.allowed_customer_phones, '{}')) x)) then
    return NEW;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'crm_reply_agent';
  perform net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-reply-agent',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-agent', secret),
    body := jsonb_build_object('message_id', NEW.id),
    timeout_milliseconds := 120000);
  return NEW;
exception when others then
  return NEW; -- never block message saving
end $$;

drop trigger if exists trg_wake_reply_agent on public.whatsapp_messages;
create trigger trg_wake_reply_agent after insert on public.whatsapp_messages
  for each row execute function crm_repair_private.wake_reply_agent();

-- ===== 20261101141618_clear_handoff_on_human_reply =====
create or replace function crm_repair_private.clear_handoff_on_human_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.direction = 'outbound' and NEW.actor_type = 'human' and NEW.conversation_id is not null then
    update public.whatsapp_conversations c
       set human_handoff_required = false,
           handoff_reason = '[أُغلق تلقائياً: رد الموظف] ' || coalesce(c.handoff_reason,''),
           handoff_updated_at = now()
     where c.id = NEW.conversation_id
       and c.company_id = NEW.company_id
       and c.human_handoff_required
       and coalesce(NEW.message_timestamp, NEW.created_at) >= coalesce(c.last_inbound_at, '-infinity'::timestamptz);
  end if;
  return NEW;
exception when others then
  return NEW; -- never block message saving
end $$;

drop trigger if exists trg_clear_handoff_on_human_reply on public.whatsapp_messages;
create trigger trg_clear_handoff_on_human_reply
after insert on public.whatsapp_messages
for each row execute function crm_repair_private.clear_handoff_on_human_reply();

create or replace function crm_repair_private.suppress_handoff_if_human_already_replied()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.human_handoff_required and not coalesce(OLD.human_handoff_required,false)
     and exists (select 1 from public.whatsapp_messages m
                  where m.conversation_id = NEW.id and m.company_id = NEW.company_id
                    and m.direction = 'outbound' and m.actor_type = 'human'
                    and coalesce(m.message_timestamp, m.created_at) >= coalesce(NEW.last_inbound_at, '-infinity'::timestamptz)) then
    NEW.human_handoff_required := false;
    NEW.handoff_reason := OLD.handoff_reason;
    NEW.handoff_updated_at := OLD.handoff_updated_at;
  end if;
  return NEW;
end $$;

drop trigger if exists crm_suppress_handoff_if_human_replied on public.whatsapp_conversations;
create trigger crm_suppress_handoff_if_human_replied
before update of human_handoff_required on public.whatsapp_conversations
for each row execute function crm_repair_private.suppress_handoff_if_human_already_replied();

-- ===== 20261104061921_whatsapp_outreach_queue =====
create table if not exists public.whatsapp_outreach_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  kind text not null default 'property_sold',
  property_id uuid,
  conversation_id uuid,
  client_id uuid not null,
  route_key text,
  messages jsonb not null default '[]'::jsonb,
  send_mode text check (send_mode in ('service','template')),
  status text not null default 'pending' check (status in ('pending','approved','sent','skipped','failed')),
  reason text,
  dry_run boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  unique (kind, property_id, client_id)
);
alter table public.whatsapp_outreach_queue enable row level security;
create policy "owner reads outreach" on public.whatsapp_outreach_queue for select to authenticated
  using (company_id in (select company_id from public.profiles where id = auth.uid() and role = 'owner'));
create policy "owner approves outreach" on public.whatsapp_outreach_queue for update to authenticated
  using (company_id in (select company_id from public.profiles where id = auth.uid() and role = 'owner'));

-- ===== 20261104080156_whatsapp_agent_prompts =====
create table if not exists public.whatsapp_agent_prompts (
  key text primary key,
  content text not null,
  source_sha text,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_agent_prompts enable row level security;
create policy "owner reads prompts" on public.whatsapp_agent_prompts for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'owner'));

-- ===== 20261104094728_outreach_queue_v2_and_rule_auto_send =====
alter table public.whatsapp_outreach_queue
  add column if not exists request_id uuid,
  add column if not exists step text,
  add column if not exists template_name text,
  add column if not exists template_params jsonb not null default '[]'::jsonb,
  add column if not exists scheduled_for timestamptz not null default now(),
  add column if not exists decided_by uuid,
  add column if not exists meta_message_id text,
  add column if not exists summary text;
alter table public.whatsapp_outreach_queue drop constraint if exists whatsapp_outreach_queue_kind_check;
create index if not exists whatsapp_outreach_queue_status_idx on public.whatsapp_outreach_queue (status, scheduled_for);
create index if not exists whatsapp_outreach_queue_request_idx on public.whatsapp_outreach_queue (request_id, created_at desc);
alter table public.whatsapp_reply_rules
  add column if not exists auto_send boolean not null default false,
  add column if not exists auto_match_regex text;
-- gradual go-live (owner, 4 Nov 2026): only bare greetings and the salary-prompt reply go out on their own
update public.whatsapp_reply_rules set auto_send = true, auto_match_regex = '^\s*(السلام عليكم|السلام عليكم ورحمة الله|السلام عليكم ورحمة الله وبركاته|السلام|سلام عليكم|السلام عليكم ورحمه الله وبركاته)\s*[.!؟?]*\s*$' where id = 'e89069e7-9171-4c1c-ba31-b308a5ba9ef5';
update public.whatsapp_reply_rules set auto_send = true, auto_match_regex = '^\s*(مرحبا|مرحبًا|مرحباً|هلا|هلا والله|هاي|hi|hello)\s*[.!؟?]*\s*$' where id = '3cec95ef-450b-4851-913c-db3131f1c4fe';
update public.whatsapp_reply_rules set auto_send = true, auto_match_regex = '(برومبت|برومت|البرومت|prompt|راتب|براتب)' where id = 'a3f8151c-d72a-4045-8bd9-c0f5dd47ce3c';

-- ===== 20261104110757_reply_variant_results =====
alter table whatsapp_reply_variants add column if not exists status text not null default 'testing', add column if not exists min_sample int not null default 20, add column if not exists source text, add column if not exists rationale text;
alter table whatsapp_reply_rules add column if not exists experiment_note text;

create or replace view whatsapp_reply_variant_outcomes with (security_invoker = true) as
select d.company_id, d.id draft_id, (d.analysis->>'matched_rule_id')::uuid rule_id, coalesce(d.analysis->>'variant_label','A') variant_label,
  d.client_id, d.conversation_id, coalesce(d.sent_at, d.decided_at, d.created_at) sent_at,
  exists (select 1 from whatsapp_messages m where m.conversation_id=d.conversation_id and m.direction='inbound' and m.message_timestamp > coalesce(d.sent_at,d.decided_at,d.created_at) and m.message_timestamp < coalesce(d.sent_at,d.decided_at,d.created_at) + interval '3 days') replied,
  exists (select 1 from viewings v where v.client_id=d.client_id and coalesce(v.archived,false)=false and v.status in ('scheduled','done') and v.created_at > coalesce(d.sent_at,d.decided_at,d.created_at) and v.created_at < coalesce(d.sent_at,d.decided_at,d.created_at) + interval '30 days') visited,
  exists (select 1 from deals x where x.client_id=d.client_id and x.stage <> 'lost' and x.created_at > coalesce(d.sent_at,d.decided_at,d.created_at) and x.created_at < coalesce(d.sent_at,d.decided_at,d.created_at) + interval '90 days') deal
from whatsapp_reply_drafts d
where d.status in ('sent','approved','edited') and coalesce((d.analysis->>'dry_run')::boolean,false)=false and d.analysis->>'matched_rule_id' ~ '^[0-9a-f-]{36}$';

create or replace view whatsapp_reply_variant_results with (security_invoker = true) as
select o.company_id, o.rule_id, r.situation, o.variant_label,
  coalesce(v.reply, case when o.variant_label='A' then r.approved_reply end) reply,
  coalesce(v.status, 'testing') variant_status, coalesce(v.min_sample,20) min_sample,
  count(*) uses, count(*) filter (where o.replied) replied, count(*) filter (where o.visited) visits, count(*) filter (where o.deal) deals,
  round(100.0*count(*) filter (where o.replied)/nullif(count(*),0),0) reply_pct,
  round(100.0*count(*) filter (where o.visited)/nullif(count(*),0),0) visit_pct,
  max(o.sent_at) last_used
from whatsapp_reply_variant_outcomes o
join whatsapp_reply_rules r on r.id=o.rule_id
left join whatsapp_reply_variants v on v.rule_id=o.rule_id and v.label=o.variant_label
group by 1,2,3,4,5,6,7;

-- ===== 20261104162932_owner_leads_kind_nullable =====
alter table public.owner_leads alter column kind drop not null;

-- ===== 20261104163005_owner_leads_match_tighter =====
create or replace function public.crm_match_owner_leads(p_notify boolean default true) returns integer language plpgsql security definer set search_path to 'public' as $f$
declare n int := 0; l record; v_owner uuid; names text; cnt int; tok text;
begin
  perform crm_sync_owner_leads();
  for l in select * from owner_leads where status in ('open','studied') and kind is not null loop
    tok := crm_area_token(l.area);
    if tok is null and l.wilayat is null then continue; end if;
    with hits as (
      select q.id request_id, coalesce(c.name,'عميل') nm, crm_money(q.budget_max) budget_max
      from client_requests q left join clients c on c.id=q.client_id
      where q.company_id=l.company_id and q.status='active' and q.request_type='buyer'
        and q.updated_at > now() - interval '90 days' and q.client_id is distinct from l.client_id and crm_money(q.budget_max) is not null
        and (crm_owner_kind(q.property_type)=l.kind or exists (select 1 from unnest(coalesce(q.property_types,'{}')) t where crm_owner_kind(t)=l.kind))
        and (l.price is null or crm_money(q.budget_max) between l.price*0.85 and l.price*1.3)
        and (case when tok is not null then
               (q.preferred_area ilike '%'||tok||'%' or exists (select 1 from unnest(coalesce(q.preferred_areas,'{}')) a where a ilike '%'||tok||'%'))
             else (q.wilayat ilike '%'||l.wilayat||'%' and coalesce(q.preferred_area,'')='') end)
        and not exists (select 1 from owner_lead_matches m where m.lead_id=l.id and m.request_id=q.id)
    ), ins as (insert into owner_lead_matches(lead_id, request_id) select l.id, request_id from hits on conflict do nothing returning request_id)
    select count(*), string_agg(h.nm || coalesce(' ('||round(h.budget_max/1000)||' الف)',''), '، ') into cnt, names from hits h;
    if cnt > 0 then
      n := n + cnt;
      if p_notify then
        select id into v_owner from profiles where company_id=l.company_id and role='owner' and is_active limit 1;
        if v_owner is not null then
          insert into notifications(user_id, type, is_read, client_id, link, title, body)
          values (v_owner, 'owner_lead_match', false, l.client_id, 'owner-leads',
            'مشترين جاهزين لعرض مالك ('||cnt||'): '||coalesce(l.kind,'')||' '||coalesce(l.area,l.wilayat,'')||coalesce(' '||round(l.price/1000)||' الف',''), left(names,400));
        end if;
      end if;
    end if;
  end loop;
  return n;
end $f$;
grant execute on function public.crm_match_owner_leads(boolean) to service_role;

-- ===== 20261104163114_owner_leads_match_now =====
create or replace function public.crm_match_owner_leads_now() returns integer language plpgsql security definer set search_path to 'public' as $f$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only'; end if;
  return public.crm_match_owner_leads(false);
end $f$;
revoke all on function public.crm_match_owner_leads_now() from public, anon;
grant execute on function public.crm_match_owner_leads_now() to authenticated;
revoke all on function public.crm_match_owner_leads(boolean) from public, anon, authenticated;
revoke all on function public.crm_sync_owner_leads() from public, anon, authenticated;
update public.notifications set link='owner-leads' where type='owner_lead_match';

-- ===== 20261105025929_agent_lessons_into_brain =====
-- 'brain_base' is the brain from the repo; 'brain' (what the agent reads) = brain_base + Ahmed's open notes.
insert into whatsapp_agent_prompts(key, content, source_sha, updated_at)
  select 'brain_base', content, source_sha, now() from whatsapp_agent_prompts where key='brain'
  on conflict (key) do nothing;

create or replace function crm_repair_private.compose_agent_brain() returns void language plpgsql security definer set search_path to 'public' as $f$
declare base text; les text;
begin
  select content into base from whatsapp_agent_prompts where key='brain_base';
  select content into les from whatsapp_agent_prompts where key='lessons';
  if base is null or length(base) < 2000 then return; end if;
  update whatsapp_agent_prompts set content = base || case when coalesce(btrim(les),'') <> '' then
      E'\n\n# تصحيحات أحمد الأخيرة\nهذي ملاحظات كتبها أحمد على ردود سابقة. طبق الدرس منها في أي موقف يشبهها، وهي أهم من القواعد فوق إذا تعارضت معها، بس لا تخالف الممنوعات ولا تكتب معلومة مو مكتوبة قدامك:\n' || les
    else '' end, updated_at = now()
  where key='brain';
end $f$;

create or replace function crm_repair_private.rebuild_agent_lessons() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare txt text;
begin
  select string_agg(line, E'\n' order by created_at) into txt from (
    select n.created_at, '- [' || to_char(n.created_at at time zone 'Asia/Muscat','DD/MM') || '] ' || n.note
      || coalesce(' (المحادثة مع ' || coalesce(nullif(cl.name,''), w.customer_name, 'عميل')
        || coalesce(' | آخر كلام العميل: ' || (select left(coalesce(m.transcript,m.body),160) from whatsapp_messages m where m.conversation_id=n.conversation_id and m.direction='inbound' and m.message_timestamp<=n.created_at order by m.message_timestamp desc limit 1),'')
        || coalesce(' | آخر رد منا: ' || (select left(m.body,160) from whatsapp_messages m where m.conversation_id=n.conversation_id and m.direction='outbound' and m.message_timestamp<=n.created_at order by m.message_timestamp desc limit 1),'')
        || ')', '')
      || coalesce(' (الرد المقترح وقتها: ' || (select left(array_to_string(d.reply_messages,' / '),200) from whatsapp_reply_drafts d where d.id=n.draft_id) || ')','') line
    from crm_owner_notes n
    left join whatsapp_conversations w on w.id = n.conversation_id
    left join clients cl on cl.id = w.client_id
    where n.status = 'open' and n.apply_now and n.created_at > now() - interval '90 days'
    order by n.created_at desc limit 40) x;
  insert into whatsapp_agent_prompts(key, content, updated_at) values ('lessons', coalesce(txt,''), now())
    on conflict (key) do update set content = excluded.content, updated_at = now();
  perform crm_repair_private.compose_agent_brain();
  return null;
end $f$;

-- ===== 20261105025947_compose_agent_brain_rpc =====
create or replace function public.crm_compose_agent_brain() returns void language sql security definer set search_path to 'public' as $$ select crm_repair_private.compose_agent_brain() $$;
revoke all on function public.crm_compose_agent_brain() from public, anon, authenticated;
grant execute on function public.crm_compose_agent_brain() to service_role;

-- ===== Scheduled jobs live in cron.job =====
-- The x-crm-agent value always comes from the vault secret crm_reply_agent; no secret is stored here.
-- habib_visit_templates_status   20 */3 * * *        whatsapp-visit-templates  {"action":"status"}
-- openai_credit_alert            */10 * * * *        system_alert to the owner when a draft failed on credits in the last 15 minutes (at most every 6 hours)
-- outreach_queue_requests        10 5-16 * * *       whatsapp-outreach  {"action":"queue_requests"}
-- outreach_send_approved         */15 5-16 * * *     whatsapp-outreach  {"action":"send_approved"}
-- outreach_templates_status      40 */3 * * *        whatsapp-outreach  {"action":"templates"}
-- outreach_seed_requests_daily   50 4 * * *          sets next_followup on up to 30 active requests quiet for 7 to 30 days
-- owner_leads_match_daily        25 4 * * *          select public.crm_match_owner_leads()
-- reply_coach_weekly             12 4 * * 6          whatsapp-reply-coach
-- whatsapp_transcribe_voice_notes 7,22,37,52 * * * * whatsapp-transcribe-backfill  {"limit":30}
