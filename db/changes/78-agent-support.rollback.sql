-- Rollback of SQL78: the two replaced functions exactly as they were live on 10 Nov 2026 (copied with pg_get_functiondef;
-- md5 of each definition checked equal after forward + rollback in a rolled-back transaction), then the thinking_followup
-- guard and the agent's conversation columns go.
-- The agent's notes and judgements are its only lasting memory (the webhook overwrites ai_summary), so they are copied first
-- to crm_repair_private.agent_note_backup_78 (owner-only like the other backups there; appended on every run, never replaced).
-- The reply agent writes these columns only when the row it read has them, in a separate update whose error is only logged,
-- so it keeps working after the rollback; a run in flight at that moment may log one memory error.
-- Refused when a function changed after SQL78: restoring the 10 Nov copy would silently discard that later change.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.crm_refresh_client_behavior(uuid)'::regprocedure));
  IF v_md5 NOT IN ('3318ddeaac44685dcfbbbb69bb41d5ae', '5e75e426362dad11b6b319320c5fb3a1') THEN
    RAISE EXCEPTION 'SQL78 rollback refused: public.crm_refresh_client_behavior changed after SQL78 (md5 %)', v_md5;
  END IF;
  v_md5 := md5(pg_get_functiondef('crm_repair_private.owner_hot_alert()'::regprocedure));
  IF v_md5 NOT IN ('e25b8da4a5beb3c5589c6851dfe9d52a', '53ff3d16e1e61319a2964318f4283c18') THEN
    RAISE EXCEPTION 'SQL78 rollback refused: crm_repair_private.owner_hot_alert changed after SQL78 (md5 %)', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.crm_refresh_client_behavior(p_client uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cl record; m record; v record; d record; r record;
  facts jsonb; tier text; tier_ar text; sc int := 0; appr text; span_days int; days_since_in int; last_out_unanswered boolean; lk record;
begin
  select b.tier as l_tier, b.tier_ar as l_tier_ar, b.score as l_score, b.approach as l_approach, b.facts as l_facts into lk from public.client_behavior b where b.client_id = p_client and b.tier_locked;
  if found then return jsonb_build_object('tier', lk.l_tier, 'tier_ar', lk.l_tier_ar, 'score', lk.l_score, 'approach', lk.l_approach, 'facts', lk.l_facts, 'locked', true); end if;
  select id, company_id, budget_max, payment_method, purchase_timing, readiness into cl from public.clients where id = p_client;
  if not found then return null; end if;
  select min(message_timestamp) first_at, max(message_timestamp) filter (where direction='inbound') last_in,
         max(message_timestamp) filter (where direction='outbound') last_out,
         count(*) filter (where direction='inbound') inbound, count(*) filter (where direction='outbound') outbound,
         count(distinct (message_timestamp at time zone 'Asia/Muscat')::date) filter (where direction='inbound') active_days,
         count(distinct matched_property_id) filter (where matched_property_id is not null) props_asked
    into m from public.whatsapp_messages where client_id = p_client or conversation_id in (select id from public.whatsapp_conversations where client_id = p_client);
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
end $function$;

CREATE OR REPLACE FUNCTION crm_repair_private.owner_hot_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.route_key in ('barka','muscat')
     and NEW.human_handoff_required
     and coalesce(NEW.handoff_reason,'') ~ '^\s*(مشتري جاد|تفاوض)\s*:'
     and (not coalesce(OLD.human_handoff_required,false) or OLD.handoff_reason is distinct from NEW.handoff_reason) then
    perform net.http_post(
      url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-crm-agent',
                   (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
      body := jsonb_build_object('conversation_id', NEW.id),
      timeout_milliseconds := 30000);
  end if;
  return NEW;
exception when others then
  return NEW;
end $function$;

ALTER TABLE public.whatsapp_outreach_queue DROP CONSTRAINT IF EXISTS whatsapp_outreach_queue_thinking_never_approved;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.whatsapp_conversations'::regclass
              AND attname = 'agent_note' AND NOT attisdropped) THEN
    CREATE TABLE IF NOT EXISTS crm_repair_private.agent_note_backup_78 (
      conversation_id uuid NOT NULL,
      agent_note text,
      agent_seriousness text,
      agent_seriousness_reason text,
      agent_profile_at timestamptz,
      backed_up_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE crm_repair_private.agent_note_backup_78 ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON crm_repair_private.agent_note_backup_78 FROM PUBLIC, anon, authenticated, service_role;
    INSERT INTO crm_repair_private.agent_note_backup_78 (conversation_id, agent_note, agent_seriousness, agent_seriousness_reason, agent_profile_at)
    SELECT id, agent_note, agent_seriousness, agent_seriousness_reason, agent_profile_at
      FROM public.whatsapp_conversations
     WHERE agent_note IS NOT NULL OR agent_seriousness IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_agent_seriousness_check;
ALTER TABLE public.whatsapp_conversations
  DROP COLUMN IF EXISTS agent_note,
  DROP COLUMN IF EXISTS agent_seriousness,
  DROP COLUMN IF EXISTS agent_seriousness_reason,
  DROP COLUMN IF EXISTS agent_profile_at;
