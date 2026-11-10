'use strict';
// SQL77 / 77b / 77c (10 Nov 2026, Ahmed's instructions 1 and 2): one client + one property = one deal card, and the
// cards on a property that left the market close by themselves. Text-level checks of the four SQL files. The behaviour
// was rehearsed on the live catalog inside rolled-back transactions; nothing here touches a database or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, 'db/changes', name), 'utf8').replace(/\r\n/g, '\n');
const forward = read('77-deals-one-card.forward.sql');
const rollback = read('77-deals-one-card.rollback.sql');
const cleanup = read('77b-deals-cleanup-20261110.sql');
const guardIndex = read('77c-deals-one-open-card-index.sql');
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex');

// Every CREATE OR REPLACE FUNCTION statement, by qualified name, up to its closing «$function$;».
function functions(sql) {
  const out = new Map();
  const re = /CREATE OR REPLACE FUNCTION ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\$function\$;/g;
  let m;
  while ((m = re.exec(sql))) out.set(m[1], m[0]);
  return out;
}
const fwd = functions(forward);
const back = functions(rollback);
const fn = (map, name) => {
  assert(map.has(name), 'missing function ' + name);
  return map.get(name);
};
// pg_get_functiondef text of a function saved in a file: the statement without its final «;», plus the newline.
const functiondef = text => text.replace(/;$/, '') + '\n';
const viewBody = sql => {
  const head = 'CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS\n';
  const start = sql.indexOf(head);
  assert(start >= 0, 'missing crm_deals_access');
  const body = sql.slice(start + head.length);
  return body.slice(0, body.indexOf(';') + 1);
};

const NEW_HELPERS = [
  'crm_repair_private.merge_duplicate_deal',
  'crm_repair_private.property_unavailable_note',
  'crm_repair_private.close_deal_property_unavailable',
  'crm_repair_private.close_deals_for_property',
  'crm_repair_private.close_deals_on_property_unavailable',
  'crm_repair_private.close_deals_on_unavailable_properties',
];
const REPLACED = ['public.sync_viewing_to_crm', 'crm_repair_private.link_viewing_interest', 'public.crm_close_stale_visit_deals'];
const LIVE_MD5 = {
  'public.sync_viewing_to_crm': '65058710025e84c947232e9193d20742',
  'crm_repair_private.link_viewing_interest': '970a3c95b5cce287a32e906e141e2e85',
  'public.crm_close_stale_visit_deals': 'e6e7a9aa16b417267dfb54f54a101553',
};
const PRE_RESERVATION = "('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation')";

test('SQL77 creates exactly the expected functions, each with an empty search_path', () => {
  assert.deepEqual([...fwd.keys()].sort(), [...NEW_HELPERS, ...REPLACED].sort());
  for (const [name, text] of fwd) assert(text.includes("SET search_path TO ''"), name);
  for (const name of [...NEW_HELPERS, ...REPLACED]) {
    if (name === 'crm_repair_private.property_unavailable_note') continue;
    assert(fn(fwd, name).includes('SECURITY DEFINER'), name + ' must be SECURITY DEFINER');
  }
  assert(!fn(fwd, 'crm_repair_private.property_unavailable_note').includes('SECURITY DEFINER'));
  for (const name of NEW_HELPERS) {
    assert(new RegExp('REVOKE ALL ON FUNCTION ' + name.replace('.', '\\.') + '\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;').test(forward), 'revoke ' + name);
  }
});

test('SQL77 refuses to replace objects that changed since the 10 Nov 2026 audit', () => {
  for (const [name, sum] of Object.entries(LIVE_MD5)) assert(forward.includes(sum), name + ' md5 guard');
  assert(forward.includes("'d477af648361686b9a0e02fcd2a10c19'"), 'crm_deals_access viewdef guard');
  assert(forward.includes("md5(v_def) NOT IN ('55bb1b1683b9d95f75302712b3e52406', '095a28bf2f8d6617a8b05e9a23bf99ac')"));
  assert(forward.indexOf('SQL77 refused') < forward.indexOf('ALTER TABLE public.deals'), 'the guard runs before any change');
});

test('the rollback restores the four replaced live bodies verbatim (md5 of pg_get_functiondef / pg_get_viewdef)', () => {
  for (const [name, sum] of Object.entries(LIVE_MD5)) {
    assert.equal(md5(functiondef(fn(back, name))), sum, name + ' is not the verbatim 10 Nov 2026 body');
    assert(!fn(back, name).includes('merged_into_deal_id'), name + ' rollback body mentions SQL77');
  }
  assert.equal(md5(viewBody(rollback)), '4bfa98cd3258c1a95b6d2990cf9300d4', 'crm_deals_access rollback view is not verbatim');
  assert.deepEqual([...back.keys()].sort(), [...REPLACED].sort());
});

test('crm_deals_access keeps the live definition and only hides merged cards', () => {
  assert.equal(viewBody(forward), viewBody(rollback).replace(/;$/, ' AND t.merged_into_deal_id IS NULL;'));
});

test('merged cards: column, foreign key, rule and private audit', () => {
  assert(forward.includes('ADD COLUMN IF NOT EXISTS merged_into_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL'));
  assert(forward.includes('ADD COLUMN IF NOT EXISTS merged_at timestamptz'));
  assert(forward.includes("CHECK (merged_into_deal_id IS NULL OR (stage = 'lost' AND merged_at IS NOT NULL AND merged_into_deal_id <> id))"));
  assert(forward.includes('CREATE TABLE IF NOT EXISTS crm_repair_private.deal_merge_audit('));
  assert(forward.includes('ALTER TABLE crm_repair_private.deal_merge_audit ENABLE ROW LEVEL SECURITY;'));
  assert(forward.includes('REVOKE ALL ON TABLE crm_repair_private.deal_merge_audit FROM PUBLIC, anon, authenticated;'));
});

test('merge_duplicate_deal closes the duplicate as merged, never as the client rejection', () => {
  const merge = fn(fwd, 'crm_repair_private.merge_duplicate_deal');
  assert(forward.includes('CREATE OR REPLACE FUNCTION crm_repair_private.merge_duplicate_deal(p_keep uuid, p_drop uuid, p_take_over boolean, p_reason text)'));
  assert(merge.includes("stage = 'lost', lost_from_stage = d.stage, lost_at = now(),"));
  assert(merge.includes('merged_into_deal_id = k.id, merged_at = now(),'));
  assert(merge.includes("'[دمج] بطاقة مكررة دُمجت في ' || k.id::text || '؛ مو رفض من العميل'"));
  const dropUpdate = merge.slice(merge.indexOf("stage = 'lost', lost_from_stage = d.stage"), merge.indexOf('where id = d.id;'));
  assert(!/lost_reason_id|lost_reason_note/.test(dropUpdate), 'the duplicate gets no loss reason');
  assert(merge.includes('v_stage := d.stage;') && merge.includes('v_viewing := coalesce(d.viewing_id, k.viewing_id);'), 'take over');
  assert(merge.includes('update public.tasks set deal_id = k.id where deal_id = d.id;'));
  assert(merge.includes('update public.activities set deal_id = k.id where deal_id = d.id;'));
  assert(merge.includes('update public.whatsapp_automation_events set deal_id = k.id where deal_id = d.id;'));
  assert(merge.includes('insert into crm_repair_private.deal_merge_audit('));
  assert(merge.includes("raise exception using errcode = '22023', message = 'merge_duplicate_has_money_or_booking';"));
  assert(merge.includes('d.stage not in ' + PRE_RESERVATION));
  assert(merge.includes('order by id for update;'));
  assert(!/update public\.deals_stage_history|deal_milestone_events set/.test(merge), 'history stays with its card');
});

test('sync_viewing_to_crm: one visit = one card, three lookup steps, merged cards ignored', () => {
  const sync = fn(fwd, 'public.sync_viewing_to_crm');
  assert(sync.includes('and d.viewing_id=new.id and d.merged_into_deal_id is null'), 'step 1');
  // step 2 (Ahmed 10 Nov: one client + one property = ONE deal, replacing SQL15's per-request isolation): the client's
  // open card on the property whatever its request, so a new request (crm_save_viewing_atomic makes one whenever the
  // card's request does not strictly match) never inserts a second card
  const step2 = sync.slice(sync.indexOf('-- SQL77 step 2'), sync.indexOf('-- step 3 (SQL15 rule)'));
  assert(step2.length > 0 && sync.indexOf('-- SQL77 step 2') < sync.indexOf('-- step 3 (SQL15 rule)'), 'step 2 before step 3');
  assert(step2.includes("and d.stage not in ('lost','closed','commission_collected')"), 'step 2 takes the open card');
  assert(step2.includes('order by case when d.request_id IS NOT DISTINCT FROM v_request_id then 0 else 1 end,d.created_at,d.id'));
  assert(!/r\.status|client_requests/.test(step2), 'step 2 never filters the open card by its request');
  assert(!sync.includes("and (v_request_id is null or d.request_id is null or r.id is null or r.status not in ('active','paused'))"),
    'the old step 3 (two active requests = two cards) is gone');
  assert(sync.includes('and d.request_id IS NOT DISTINCT FROM v_request_id and d.merged_into_deal_id is null'), 'step 3 (SQL15 rule)');
  // adoption and attribution, computed once for whichever step found the card
  assert(sync.includes("select v_current_stage not in ('lost','closed','commission_collected') and v_request_id is not null"), 'adopts on open cards only');
  assert(sync.includes("and (d.request_id is null or r.id is null or r.status not in ('active','paused')),"), 'adopts only an unknown or inactive request');
  assert(sync.includes("d.request_id is distinct from v_request_id and r.status in ('active','paused')"), 'another active journey');
  assert(sync.includes('into v_adopt_request,v_other_journey'));
  assert(sync.includes('v_adopt_request:=coalesce(v_adopt_request,false);') && sync.includes('v_other_journey:=coalesce(v_other_journey,false);'));
  const keepAgent = 'agent_id=case when v_other_journey then coalesce(agent_id,new.agent_id) else coalesce(new.agent_id,agent_id) end';
  assert.equal(sync.split(keepAgent).length - 1, 3, 'a card of another active journey keeps its agent in all three updates');
  assert(!/agent_id=coalesce\(new\.agent_id,agent_id\)/.test(sync), 'no update reassigns the agent unconditionally');
  assert(sync.includes('and d.client_id=ctx.client_id and d.property_id=ctx.property_id and d.merged_into_deal_id is null'), 'deal form context');
  assert(sync.indexOf('and d.viewing_id=new.id') < sync.indexOf('and d.request_id IS NOT DISTINCT FROM v_request_id and d.merged_into_deal_id'));
  assert(sync.includes("raise exception using errcode='22023',message='viewing_request_ambiguous';"), 'keeps the ambiguity guard');
  assert(sync.includes('perform crm_repair_private.set_primary_rejection('), 'keeps the primary rejection');
  assert(sync.includes("if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;"));
  assert(forward.includes("replaces SQL15's per-request isolation"), 'the header records the 10 Nov decision');
});

test('sync_viewing_to_crm: no card on a property off the market, closed cards stay closed', () => {
  const sync = fn(fwd, 'public.sync_viewing_to_crm');
  // contract B: sold or withdrawn, or archived; «غير متاح حالياً» (not_available) without archiving is still on the list
  assert(sync.includes("v_unavailable:=coalesce(v_prop_status in ('sold','withdrawn'),false) or coalesce(v_prop_archived,false);"));
  assert(!/v_unavailable:=[^;]*not_available/.test(sync), 'a not_available property that is not archived is not off the market');
  assert(/if v_deal_id is null then\s+if not v_unavailable then\s+insert into public\.deals\(/.test(sync), 'never creates a card there');
  assert(sync.includes('if v_workflow_context or (not v_unavailable and v_result_changed and not exists('), 'reopen guard');
  assert(sync.includes("crm_repair_private.close_deal_property_unavailable(v_deal_id,'visit_update',null,true)='closed'"));
  assert(sync.includes("if v_unavailable and not v_workflow_context and coalesce(v_prop_archive_reason,'')<>'duplicate' then"));
  for (const col of ['status', 'client_feedback', 'pipeline_outcome', 'rejection_reason', 'archived']) {
    assert(sync.includes('old.' + col + ' is distinct from new.' + col), 'result change on ' + col);
  }
  assert(sync.includes("lost_reason_id=case when v_current_stage='lost' and v_reason_id is null then lost_reason_id else v_reason_id end"));
  assert(sync.includes("lost_at=case when v_current_stage='lost' then coalesce(lost_at,now()) else now() end"));
});

test('sync_viewing_to_crm keeps the unchanged parts of the live body', () => {
  const live = fn(back, 'public.sync_viewing_to_crm');
  const sync = fn(fwd, 'public.sync_viewing_to_crm');
  const slice = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)) + to.length);
  for (const [from, to] of [
    ["v_reason_code:=case coalesce(new.rejection_reason,'')", 'else null end;'],
    ['if new.status=\'done\' then', "v_target_stage:='viewing_scheduled'; v_inquiry_status:='viewing_scheduled';"],
    ['if v_inquiry_id is null and new.status<>\'cancelled\' then', ') returning id into v_inquiry_id;'],
    ['            when v_target_stage=\'negotiation\' then \'negotiation\'', 'else v_current_stage end,'],
  ]) {
    const part = slice(live, from, to);
    assert(part.length > from.length, 'live part ' + from);
    assert(sync.includes(part), 'changed: ' + from);
  }
});

test('link_viewing_interest adopts the interest saved before the request, respecting both unique indexes', () => {
  const link = fn(fwd, 'crm_repair_private.link_viewing_interest');
  assert(link.includes('and (request_id IS NOT DISTINCT FROM new.request_id or (new.request_id is not null and request_id is null))'));
  assert(link.includes('order by case when request_id IS NOT DISTINCT FROM new.request_id then 0 else 1 end,created_at limit 1 for update;'));
  assert(link.includes('request_id=coalesce(request_id,new.request_id),'));
  assert(link.includes('SQL77'), 'marker used by the idempotent apply guard');
  const sync = fn(fwd, 'public.sync_viewing_to_crm');
  assert(sync.includes('and (pi.request_id IS NOT DISTINCT FROM v_request_id or (v_request_id is not null and pi.request_id is null))'));
});

test('closing rule: open pre-reservation cards only, never money, history, merged or the buyer', () => {
  const one = fn(fwd, 'crm_repair_private.close_deal_property_unavailable');
  assert(one.includes('if d.stage not in ' + PRE_RESERVATION + " then return 'stage'; end if;"));
  assert(one.includes("if d.entry_mode = 'historical' then return 'historical'; end if;"));
  assert(one.includes("if d.reservation_confirmed_at is not null or coalesce(d.deposit_amount, 0) <> 0 then return 'reservation'; end if;"));
  assert(one.includes("coalesce(x.status, 'active') not in ('cancelled','refunded','forfeited')) then return 'deposit'"));
  assert(one.includes("if d.merged_into_deal_id is not null then return 'merged'; end if;"));
  assert(one.includes("return 'buyer';"));
  assert(one.includes("return 'reservation_on_property';"));
  assert(one.includes("if coalesce(v_archive_reason, '') = 'duplicate' then return 'duplicate'; end if;"));
  // contract B scope: sold or withdrawn, or archived; «غير متاح حالياً» alone keeps its cards (R13 records their visits)
  assert(one.includes("if not (coalesce(v_status in ('sold','withdrawn'), false) or v_archived) then return 'available'; end if;"));
  assert(!one.includes("'not_available'"), 'not_available alone never closes a card');
  assert(one.includes("r.code = 'property_unavailable' and r.is_active is true"));
  assert(one.includes("perform set_config('request.jwt.claims', '', true);"), 'the system closes, not the caller');
  assert(one.includes("perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);"), 'login restored');
  assert(one.includes("exception when others then\n    v_out := 'error:' || sqlstate;"), 'one card never fails the save');
  assert(one.includes("'system', 'internal', 'system', '[تلقائي] ' || v_note"), 'activities row actor_type system');
  assert(!/closed_at\s*=/.test(one), 'never touches closed_at');
  const note = fn(fwd, 'crm_repair_private.property_unavailable_note');
  assert(note.includes("select 'تلقائي: ' || case"));
  for (const words of ['انباع عن طريقنا', 'انباع عن طريق غيرنا', 'انتهى عقد تسويق العقار', 'المالك سحب العقار', 'ما عاد متاح']) {
    assert(note.includes(words), words);
  }
});

test('one owner notification per property names the clients whose cards closed and those left open', () => {
  const prop = fn(fwd, 'crm_repair_private.close_deals_for_property');
  assert(prop.includes('v_owner := crm_repair_private.investment_owner(p.company_id);'));
  assert(prop.includes("values (v_owner, 'deal_auto_closed', false, 'deals', 'انقفلت صفقات عقار ما عاد متاح', left(v_body, 1500));"));
  assert(prop.includes("if p_apply and (jsonb_array_length(v_closed) > 0 or jsonb_array_length(v_skipped) > 0) then"));
  assert(prop.includes('v_closed_names := v_closed_names || r.client_name;'));
  assert(prop.includes("array_to_string(v_closed_names, '، ')"), 'the closed cards by client name, not only a count');
  assert(prop.includes("array_to_string(v_lines, '، ')"), 'the cards left open, by client name and why');
  assert((prop.match(/insert into public\.notifications/g) || []).length === 1);
});

test('every card left open becomes one owner task in the daily work (nothing reads deal_auto_closed notifications yet)', () => {
  const prop = fn(fwd, 'crm_repair_private.close_deals_for_property');
  assert(prop.includes('insert into public.tasks(company_id, user_id, client_id, deal_id, request_id, title, notes, due_date, priority, done)'));
  assert(prop.includes("values (p.company_id, v_owner, (x ->> 'client_id')::uuid, (x ->> 'deal_id')::uuid, (x ->> 'request_id')::uuid,"),
    'assigned to the owner and linked to the card, its client and request (branch and investment privacy follow the card)');
  assert(prop.includes("left('راجع صفقة ' || (x ->> 'client_name') || ': ' || v_label || ' ' || v_state"), 'the title names the client and the property');
  assert(prop.includes("v_today, 'high', false);"), 'high priority, due today (crm_dashboard_work lists it first)');
  assert(prop.includes("and not coalesce(t.done, false) and t.title like 'راجع صفقة %') then"), 'never a second task while one is open');
  assert(prop.includes('for x in select e.value from jsonb_array_elements(v_review) e loop'));
  assert((prop.match(/insert into public\.tasks/g) || []).length === 1);
  assert(prop.indexOf("perform set_config('request.jwt.claims', '', true);") < prop.indexOf('insert into public.tasks('), 'written by the system, not the caller');
  assert(prop.indexOf('insert into public.tasks(') < prop.indexOf("perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);"), 'login restored after');
  assert(/raise warning 'SQL77 review task for deal % failed: %'/.test(prop), 'a task failure never fails the property save');
  assert(prop.includes("'review_tasks', v_tasks"));
  const helper = fn(fwd, 'crm_repair_private.close_deals_on_unavailable_properties');
  assert(helper.includes("v_tasks := v_tasks + coalesce((v_one ->> 'review_tasks')::integer, 0);"));
});

test('the properties trigger fires on sold/withdrawn, on archiving and on archived -> not_available', () => {
  assert(forward.includes('CREATE TRIGGER crm_close_deals_on_property_unavailable\n  AFTER UPDATE OF status, archived ON public.properties'));
  assert(forward.includes("WHEN ((new.status IN ('sold','withdrawn') AND old.status IS DISTINCT FROM new.status)"));
  assert(forward.includes('OR (coalesce(new.archived, false) AND NOT coalesce(old.archived, false))'));
  assert(forward.includes("OR (coalesce(new.archived, false) AND new.status = 'not_available' AND old.status IS DISTINCT FROM new.status))"));
  assert(forward.includes('EXECUTE FUNCTION crm_repair_private.close_deals_on_property_unavailable();'));
  const trig = fn(fwd, 'crm_repair_private.close_deals_on_property_unavailable');
  assert(trig.includes("if coalesce(to_jsonb(new) ->> 'archive_reason', '') = 'duplicate' then return null; end if;"));
  assert(trig.includes('exception when others then'), 'the property save never fails');
  const helper = fn(fwd, 'crm_repair_private.close_deals_on_unavailable_properties');
  assert(helper.includes("where pr.status in ('sold','withdrawn')"), 'one-off helper scope (contract B)');
  assert(forward.includes('CREATE OR REPLACE FUNCTION crm_repair_private.close_deals_on_unavailable_properties(p_apply boolean)\n RETURNS jsonb'));
});

test('the 90-day job: reason per company and active, merged cards skipped, merges never age a journey', () => {
  const job = fn(fwd, 'public.crm_close_stale_visit_deals');
  assert(job.includes("join public.rejection_reasons rr on rr.company_id = d.company_id and rr.code = 'no_response_after_visit' and rr.is_active is true"));
  assert(job.includes('and d.merged_into_deal_id is null'));
  assert(job.includes('where md.merged_into_deal_id = d.id'));
  assert(!job.includes("select id into rid from public.rejection_reasons where code='no_response_after_visit' limit 1"));
});

test('the deal form never picks a merged card: one md5-checked condition, removed again by the rollback', () => {
  assert(forward.includes("v_old constant text := 'WHERE company_id=c AND viewing_id=vid ORDER BY created_at,id LIMIT 1 FOR UPDATE';"));
  assert(forward.includes("v_new constant text := 'WHERE company_id=c AND viewing_id=vid AND merged_into_deal_id IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE';"));
  assert(forward.includes('EXECUTE replace(v_def, v_old, v_new);'));
  assert(rollback.includes("v_old constant text := 'WHERE company_id=c AND viewing_id=vid AND merged_into_deal_id IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE';"));
  assert(rollback.includes("<> '55bb1b1683b9d95f75302712b3e52406' THEN"));
  assert(rollback.indexOf('$unpatch$') < rollback.indexOf('DROP COLUMN IF EXISTS merged_into_deal_id'));
});

test('the rollback removes everything SQL77 added and keeps the data', () => {
  assert(rollback.includes('DROP TRIGGER IF EXISTS crm_close_deals_on_property_unavailable ON public.properties;'));
  for (const name of NEW_HELPERS) assert(rollback.includes('DROP FUNCTION IF EXISTS ' + name + '('), name);
  assert(rollback.includes('DROP INDEX IF EXISTS public.deals_one_open_card_per_client_property;'));
  assert(rollback.includes('DROP INDEX IF EXISTS public.deals_one_open_card_per_viewing;'));
  assert(rollback.includes('ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_merged_card_stays_lost;'));
  assert(rollback.includes('DROP COLUMN IF EXISTS merged_at, DROP COLUMN IF EXISTS merged_into_deal_id;'));
  assert(!/DROP TABLE/i.test(rollback), 'audit and cleanup snapshots stay');
  assert(rollback.indexOf('CREATE OR REPLACE VIEW public.crm_deals_access') < rollback.indexOf('DROP COLUMN IF EXISTS merged_at'));
});

const MERGES = [
  ['589feb47-db47-400f-952b-ed769e4473af', '0607f87e-0008-410a-9563-a4f06469503c', 'false'],
  ['04ae2c63-9422-444d-871a-5a6b85d2a62a', '0d9d3458-5255-4ae0-95b4-7d54aa8dc3b4', 'true'],
  ['7a10308f-370f-4aa3-96cf-bf9b1d2961dd', 'df608450-b9e1-46a1-acc9-1edd6dc4c7df', 'true'],
  ['b3aee65a-6bc0-40c0-96d6-2b4120358d7d', '97687bce-d18e-4254-a08f-5ce75f82dab8', 'true'],
  ['81c87556-8924-47e8-954f-ef0b7156358a', '59ad628e-2372-44e8-afd4-616c857c8629', 'true'],
  ['44e9916f-9c2d-4cb9-b35b-baaa9ccbe74a', 'a0f7f0ac-3555-4aa5-b30a-006b333af8dc', 'false'],
  ['007b1e4f-3c84-4d82-a81e-f88b8cc1edd1', 'daeff763-2d9a-4f68-b2c9-3547b771b76d', 'false'],
];
const EXPECTED_CLOSE = ['12a3ad83-4c3e-4018-b729-9f4f23e84044', '6ab03d65-e9da-404d-aedf-b137140cbb3a', '7dabfce3-c13d-4073-9bfe-7f9b366c795d',
  '233732d2-2b03-47a4-89c7-cd3e3fe1dc31', '7a10308f-370f-4aa3-96cf-bf9b1d2961dd', 'e53c71e1-1ccf-46b9-9776-248e74afa90f',
  'db119bbe-8dca-4533-a8ad-2b19f1e5a31d', '2e164119-3cd9-43b1-b03e-f71e8b970c5a', '3e3c78bc-f264-4386-a6fd-044eb1b9842c',
  '2071daed-4958-4bc0-8078-a72425ef2b4f', '12088094-be81-4a22-b260-3830084b2dac', '9fa91880-8feb-443b-bf32-4b050aa7cdac',
  '6d74ef25-72d3-48e2-99b0-0c23ac0aa9d4'];

test('77b merges the 7 audited pairs with the decided take-over, checked against the audit versions', () => {
  for (const [keep, drop, takeOver] of MERGES) {
    assert(new RegExp("'" + keep + "','" + drop + "'," + takeOver + ',').test(cleanup), keep + ' <- ' + drop + ' take_over ' + takeOver);
  }
  assert(cleanup.includes('PERFORM crm_repair_private.merge_duplicate_deal(m.keep_id, m.drop_id, m.take_over,'));
  assert(cleanup.includes('AND d.stage = m.keep_stage AND d.updated_at = m.keep_updated AND d.merged_into_deal_id IS NULL'), 'optimistic check');
  assert(cleanup.includes('ORDER BY d.id FOR UPDATE;'), 'cards locked before the check');
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: the 7 duplicates are not all merged as lost without a loss reason';"));
  assert(cleanup.indexOf('merge_duplicate_deal(m.keep_id') < cleanup.indexOf('close_deals_on_unavailable_properties(true)'), 'pair 3 is merged before the closing pass');
});

test('77b archives the AI duplicate «done» visits of one real visit (pair 1 keeps fa343edd)', () => {
  assert(cleanup.includes("WHERE v.created_via = 'whatsapp_ai' AND v.status = 'done' AND coalesce(v.archived, false) = false"));
  assert(cleanup.includes('PARTITION BY v.company_id, v.client_id, v.property_id, v.viewing_date ORDER BY v.created_at, v.id'));
  for (const id of ['fa343edd-7aac-4077-a1c3-0dfbe35a2180', 'd2daddde-6345-4ac7-9f58-c2abd782c8f2', 'c2f1fbc7-b228-4546-9d52-9a09d09cfac5']) {
    assert(cleanup.includes(id), id);
  }
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: a live card still points at an archived duplicate visit';"));
  assert(!/DELETE FROM/i.test(cleanup), 'nothing is deleted');
});

test('77b closes the open cards on sold/withdrawn properties through the same automation and checks the result', () => {
  for (const id of EXPECTED_CLOSE) assert(cleanup.includes("('" + id + "',"), id);
  assert.equal(EXPECTED_CLOSE.length, 13);
  assert(cleanup.includes('crm_repair_private.close_deals_on_unavailable_properties(false)'), 'dry run first');
  assert(cleanup.includes('SELECT crm_repair_private.close_deals_on_unavailable_properties(true) AS r;'));
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: a client still has two open cards on one property';"));
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: a visit still has two open cards';"));
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: the buyer deal 722aa5fc changed';"));
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: a property status or archive state changed';"));
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: % HTTP request(s) were queued', v;"));
  assert(cleanup.includes('crm_repair_private.deals_cleanup_20261110'), 'before-images');
  assert(!/UPDATE\s+public\.properties/i.test(cleanup), 'no property status change, so no outreach');
  assert(!/net\.http_post|whatsapp_outreach_queue\s*\(/i.test(cleanup), 'no customer message');
});

test('77c holds only the unique guards, in its own transaction', () => {
  // one client + one property = one open card, whatever path tries a second one (fails loudly, 23505)
  assert(guardIndex.includes("CREATE UNIQUE INDEX deals_one_open_card_per_client_property ON public.deals(company_id, client_id, property_id) WHERE merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected');"));
  assert(guardIndex.includes("RAISE EXCEPTION 'SQL77c refused: a client still has two open cards on one property; apply 77b first';"));
  assert(guardIndex.includes('WHERE client_id IS NOT NULL AND property_id IS NOT NULL AND merged_into_deal_id IS NULL'), 'the check groups like the index (NULLs never collide)');
  assert(guardIndex.includes("CREATE UNIQUE INDEX deals_one_open_card_per_viewing ON public.deals(viewing_id) WHERE viewing_id IS NOT NULL AND merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected');"));
  assert(guardIndex.includes("RAISE EXCEPTION 'SQL77c refused: a visit still has two open cards; apply 77b first';"));
  assert(guardIndex.indexOf('SQL77c refused') < guardIndex.indexOf('CREATE UNIQUE INDEX'), 'checked before the indexes are built');
  assert(!/UPDATE|INSERT|DELETE/.test(guardIndex.replace(/--.*$/gm, '')), '77c writes no rows');
  assert(!/CREATE UNIQUE INDEX deals_one_open_card_per_(viewing|client_property)/.test(forward + cleanup), 'not in a transaction that updates deals (55006)');
  assert(cleanup.includes("RAISE EXCEPTION 'SQL77b: a client still has two open cards on one property';"), '77b leaves the index buildable');
});

test('no customer phone number is written into the SQL77 files', () => {
  for (const [name, text] of [['77', forward], ['77 rollback', rollback], ['77b', cleanup], ['77c', guardIndex]]) {
    assert(!/(?:\+|00)?968[\s-]?\d{8}/.test(text), name);
    assert(!/(?<![\w-])[79]\d{7}(?![\w-])/.test(text), name);
  }
});
