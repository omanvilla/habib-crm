-- SQL78 (10 Nov 2026, Ahmed's instruction 4 and his decisions R18-R24): database support for the reply agent («العقل»).
-- 1. whatsapp_conversations keeps the agent's own memory and judgement of the client, written only by the agent (service role):
--    agent_note (its running note, out.crm_note; the webhook overwrites ai_summary with a one-message summary, never this),
--    agent_seriousness (strong / possible / weak / unknown), agent_seriousness_reason (short Arabic) and agent_profile_at.
--    The reply agent reads them back in «ملف العميل» of the same chat only (branch isolation: the other number's chat stays out).
--    Access: the table has table-level privileges (authenticated: all) and no column grants, so the new columns follow the
--    existing RLS like every other column: whatsapp_conversations_select_by_role (owner every chat, a branch account only
--    the chats of its own route) and the restrictive investment_owner_only policy. authenticated has no UPDATE policy, so
--    the browser cannot write them. No GRANT is needed; a column grant would make these four differ from the other columns.
-- 2. crm_refresh_client_behavior: the real stages of deals_stage_check (bought: closed, commission_collected; hot: negotiation,
--    deposit, awaiting_finance, finance_approved, awaiting_clearance, ownership_transfer), and the wanderer rule counts distinct
--    properties visited (3+), not visit rows (duplicate AI visit rows made clients wanderers). The rest is the live body: a
--    deposit on any deal still counts, archived visits stay ignored, a tier Ahmed locked (tier_locked, live since 8 Nov) is
--    returned unchanged.
-- 3. owner_hot_alert: a booked meeting («اجتماع:», R19) is posted to whatsapp-owner-hot-alert like «مشتري جاد:» and «تفاوض:».
--    That edge function checks the reason again with its own HOT pattern. Until it accepts «اجتماع» (with a meeting label, as a
--    soft handoff) and is re-pinned, it answers skipped:not_hot: Ahmed gets the CRM notification and task, no WhatsApp alert.
-- 4. whatsapp_outreach_queue kind 'thinking_followup' (R21): no check limits kind (whatsapp_outreach_queue_kind_check was dropped
--    on 4 Nov, 20261105_live_sync_APPLIED.sql); asserted below. crm_followups_today, crm_followup_mark_sent, the person-message
--    trigger, keep_review_decision and every review / auto-send / auto-release query of whatsapp-visit-followup-auto use
--    kind = 'request_followup' only, so none of them shows, reviews or sends a thinking_followup row. whatsapp-visit-followup-auto
--    inserts the R21 row as pending and claims it at once (sent, failed or skipped). Outside SQL, two readers take every kind:
--    «ردود انتظر موافقتك» (crm-reply-approvals.js) lists pending rows of any kind but request_followup, and whatsapp-outreach
--    sends every approved row (owner decision, cron outreach_send_approved). A row left pending by a run that died must never
--    be approved there: whatsapp_outreach_queue_thinking_never_approved makes that approval fail instead of sending the question
--    hours late. Rejecting (skipped) still works.
-- Left out after the 10 Nov review: compose_agent_brain (whether Ahmed's open notes rank above or below the fixed rules is his
-- call and not in his 10 Nov instructions; the notes that became R18-R24 are closed after agent-prompt-sync instead,
-- docs/agent-rules.md), crm_client_behavior_text (a line with the agent's judgement taken from any branch's chat; the agent
-- already reads the judgement of its own chat) and a lost deal's deposit (not requested).
-- Refused unless the two replaced functions are still the 10 Nov live bodies (the rollback restores those) or already this version.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.crm_refresh_client_behavior(uuid)'::regprocedure));
  IF v_md5 NOT IN ('5e75e426362dad11b6b319320c5fb3a1', '3318ddeaac44685dcfbbbb69bb41d5ae') THEN
    RAISE EXCEPTION 'SQL78 refused: public.crm_refresh_client_behavior changed since 10 Nov 2026 (md5 %)', v_md5;
  END IF;
  v_md5 := md5(pg_get_functiondef('crm_repair_private.owner_hot_alert()'::regprocedure));
  IF v_md5 NOT IN ('53ff3d16e1e61319a2964318f4283c18', 'e25b8da4a5beb3c5589c6851dfe9d52a') THEN
    RAISE EXCEPTION 'SQL78 refused: crm_repair_private.owner_hot_alert changed since 10 Nov 2026 (md5 %)', v_md5;
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS agent_note text,
  ADD COLUMN IF NOT EXISTS agent_seriousness text,
  ADD COLUMN IF NOT EXISTS agent_seriousness_reason text,
  ADD COLUMN IF NOT EXISTS agent_profile_at timestamptz;
ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_agent_seriousness_check;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_agent_seriousness_check
  CHECK (agent_seriousness IN ('strong', 'possible', 'weak', 'unknown'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
              WHERE c.conrelid = 'public.whatsapp_outreach_queue'::regclass AND c.contype = 'c' AND a.attname = 'kind'
                AND c.conname <> 'whatsapp_outreach_queue_thinking_never_approved') THEN
    RAISE EXCEPTION 'SQL78: a CHECK constraint limits whatsapp_outreach_queue.kind; add thinking_followup to it first';
  END IF;
END $$;

ALTER TABLE public.whatsapp_outreach_queue DROP CONSTRAINT IF EXISTS whatsapp_outreach_queue_thinking_never_approved;
ALTER TABLE public.whatsapp_outreach_queue ADD CONSTRAINT whatsapp_outreach_queue_thinking_never_approved
  CHECK (kind <> 'thinking_followup' OR status <> 'approved');

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
  -- SQL78: bought and hot follow the stages of deals_stage_check
  select count(*) deals_n, coalesce(bool_or(coalesce(deposit_amount,0) > 0),false) has_deposit,
         coalesce(bool_or(stage in ('closed','commission_collected')),false) bought,
         coalesce(bool_or(stage in ('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')),false) in_negotiation
    into d from public.deals where client_id = p_client;
  select count(*) filter (where closed_won_at is not null) won_n into r from public.client_requests where client_id = p_client;
  span_days := case when m.first_at is null then 0 else greatest(0, extract(day from now() - m.first_at)::int) end;
  days_since_in := case when m.last_in is null then 9999 else extract(day from now() - m.last_in)::int end;
  last_out_unanswered := m.last_out is not null and (m.last_in is null or m.last_out > m.last_in) and m.last_out < now() - interval '2 days';
  if d.bought or r.won_n > 0 then tier := 'bought'; tier_ar := 'اشترى منا قبل';
  elsif d.has_deposit or d.in_negotiation then tier := 'hot'; tier_ar := 'ساخن (داخل تفاوض أو حجز)';
  -- SQL78: wanderer = 3 or more different properties visited, not 3 visit rows
  elsif v.props_visited >= 3 or m.props_asked >= 5 or (span_days > 45 and m.inbound >= 15 and v.done_n = 0) then tier := 'wanderer'; tier_ar := 'متجوّل (يسأل ويزور عقارات كثيرة بدون قرار)';
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
     and coalesce(NEW.handoff_reason,'') ~ '^\s*(مشتري جاد|تفاوض|اجتماع)\s*:'
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
