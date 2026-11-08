-- 8 Nov 2026 (Ahmed): the agent must understand each client's behaviour over time (how serious, how many properties, visits, how responsive)
-- and pick the priority and style of follow-up. Facts come from messages, visits, deals and requests; nothing is guessed.
create table if not exists public.client_behavior (
  client_id uuid primary key references public.clients(id) on delete cascade,
  company_id uuid not null,
  facts jsonb not null default '{}'::jsonb,
  tier text not null default 'unknown',
  tier_ar text,
  score integer not null default 0,
  approach text,
  updated_at timestamptz not null default now()
);
alter table public.client_behavior enable row level security;
drop policy if exists client_behavior_owner_select on public.client_behavior;
create policy client_behavior_owner_select on public.client_behavior for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.company_id = client_behavior.company_id));

create or replace function public.crm_refresh_client_behavior(p_client uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cl record; m record; v record; d record; r record;
  facts jsonb; tier text; tier_ar text; sc int := 0; appr text; span_days int; days_since_in int; last_out_unanswered boolean;
begin
  select id, company_id, budget_max, payment_method, purchase_timing, readiness into cl from public.clients where id = p_client;
  if not found then return null; end if;
  select min(message_timestamp) first_at, max(message_timestamp) filter (where direction='inbound') last_in,
         max(message_timestamp) filter (where direction='outbound') last_out,
         count(*) filter (where direction='inbound') inbound, count(*) filter (where direction='outbound') outbound,
         count(distinct (message_timestamp at time zone 'Asia/Muscat')::date) filter (where direction='inbound') active_days,
         count(distinct matched_property_id) filter (where matched_property_id is not null) props_asked
    into m from public.whatsapp_messages where client_id = p_client;
  select count(*) filter (where status='done') done_n, count(*) filter (where status='no_show') no_show_n,
         count(distinct property_id) filter (where status='done') props_visited
    into v from public.viewings where client_id = p_client and coalesce(archived,false)=false;
  select count(*) deals_n, coalesce(bool_or(coalesce(deposit_amount,0) > 0),false) has_deposit,
         coalesce(bool_or(stage in ('commission_collected','awaiting_clearance','won','closed_won','sold')),false) bought,
         coalesce(bool_or(stage in ('negotiation','reservation','deposit','contract')),false) in_negotiation
    into d from public.deals where client_id = p_client;
  select count(*) filter (where closed_won_at is not null) won_n into r from public.client_requests where client_id = p_client;
  span_days := case when m.first_at is null then 0 else greatest(0, extract(day from now() - m.first_at)::int) end;
  days_since_in := case when m.last_in is null then 9999 else extract(day from now() - m.last_in)::int end;
  last_out_unanswered := m.last_out is not null and (m.last_in is null or m.last_out > m.last_in) and m.last_out < now() - interval '2 days';
  if d.bought or r.won_n > 0 then tier := 'bought'; tier_ar := 'اشترى منا قبل';
  elsif d.has_deposit or d.in_negotiation then tier := 'hot'; tier_ar := 'ساخن (داخل تفاوض أو حجز)';
  elsif v.done_n >= 3 or m.props_asked >= 5 or (span_days > 45 and m.inbound >= 15 and v.done_n = 0) then tier := 'wanderer'; tier_ar := 'متجوّل (يسأل ويزور عقارات كثيرة بدون قرار)';
  elsif v.done_n >= 1 and days_since_in <= 3 then tier := 'hot'; tier_ar := 'ساخن (زار وتواصل قريب)';
  elsif days_since_in > 14 or last_out_unanswered then tier := 'cold'; tier_ar := 'بارد (ما يرد)';
  elsif cl.budget_max is not null and (v.done_n >= 1 or cl.payment_method is not null) then tier := 'serious'; tier_ar := 'جاد';
  else tier := 'new'; tier_ar := 'جديد أو غير واضح';
  end if;
  sc := least(40, v.done_n * 20) + (case when cl.budget_max is not null then 10 else 0 end) + (case when cl.payment_method is not null then 10 else 0 end)
        + (case when days_since_in <= 3 then 20 when days_since_in <= 14 then 10 else 0 end) + least(10, coalesce(m.active_days,0))
        + (case when d.has_deposit then 20 else 0 end) - (case when tier = 'wanderer' then 15 else 0 end);
  sc := greatest(0, least(100, sc));
  appr := case tier
    when 'hot' then 'أولوية قصوى: رد سريع وركّز على الخطوة الجاية (موعد أو قرار)، بدون أسئلة كثيرة.'
    when 'serious' then 'عميل جاد: نظّم له الزيارات وتابعه بعد كل زيارة بساعة ونص.'
    when 'wanderer' then 'متجوّل: لا تعرض عقارات جديدة بدون ما تفهم وش يبحث بالضبط. اسأله مرة وحدة "ايش اللي ناقصك او ما ناسبك في اللي شفته ؟" وخله هو يحدد.'
    when 'cold' then 'بارد: متابعة متباعدة ومرة وحدة، بدون ضغط.'
    when 'bought' then 'اشترى منا قبل: عامله بأولوية وودّ، ما نبيع له بالإلحاح.'
    else 'جديد: افهم وش يبي واسأله عن اسمه مرة وحدة.' end;
  facts := jsonb_build_object('first_contact_days', span_days, 'active_days', coalesce(m.active_days,0), 'inbound', coalesce(m.inbound,0), 'outbound', coalesce(m.outbound,0),
     'properties_asked', coalesce(m.props_asked,0), 'visits_done', coalesce(v.done_n,0), 'visits_no_show', coalesce(v.no_show_n,0), 'properties_visited', coalesce(v.props_visited,0),
     'days_since_last_message', case when days_since_in = 9999 then null else days_since_in end, 'budget_max', cl.budget_max, 'payment_method', cl.payment_method, 'purchase_timing', cl.purchase_timing,
     'deals', d.deals_n, 'deposit', d.has_deposit);
  insert into public.client_behavior (client_id, company_id, facts, tier, tier_ar, score, approach, updated_at)
  values (p_client, cl.company_id, facts, tier, tier_ar, sc, appr, now())
  on conflict (client_id) do update set facts = excluded.facts, tier = excluded.tier, tier_ar = excluded.tier_ar, score = excluded.score, approach = excluded.approach, updated_at = now();
  return jsonb_build_object('tier', tier, 'tier_ar', tier_ar, 'score', sc, 'approach', appr, 'facts', facts);
end $$;
revoke all on function public.crm_refresh_client_behavior(uuid) from public, anon, authenticated;

create or replace function public.crm_client_behavior_text(p_client uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare j jsonb; f jsonb;
begin
  j := public.crm_refresh_client_behavior(p_client);
  if j is null then return ''; end if;
  f := j->'facts';
  return 'سلوك العميل (محسوب من سجله): ' || (j->>'tier_ar') || ' | درجة ' || (j->>'score') || ' من 100'
    || E'\n' || 'له ' || (f->>'first_contact_days') || ' يوم يتواصل، كتب في ' || (f->>'active_days') || ' يوم مختلف، سأل عن ' || (f->>'properties_asked') || ' عقار، زار ' || (f->>'visits_done') || ' (' || (f->>'properties_visited') || ' عقار مختلف)'
    || E'\n' || 'أسلوب التعامل: ' || (j->>'approach');
end $$;
revoke all on function public.crm_client_behavior_text(uuid) from public, anon, authenticated;

create or replace function public.crm_refresh_recent_client_behavior()
returns int language plpgsql security definer set search_path = '' as $$
declare c uuid; n int := 0;
begin
  for c in select distinct m.client_id from public.whatsapp_messages m where m.client_id is not null and m.message_timestamp > now() - interval '3 days' limit 300 loop
    perform public.crm_refresh_client_behavior(c); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.crm_refresh_recent_client_behavior() from public, anon, authenticated;
select cron.schedule('client_behavior_refresh', '25 */2 * * *', $$select public.crm_refresh_recent_client_behavior()$$);
