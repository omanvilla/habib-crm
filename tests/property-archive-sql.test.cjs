'use strict';
// SQL76 / 76b (10 Nov 2026, Ahmed's instruction 3): the property archive. Text-level checks of the three SQL files.
// The behaviour itself was rehearsed on the live catalog inside rolled-back transactions (76 + 76b with the RPCs as
// the owner, the Barka agent, the service role and anon, the expiry job; then a second apply and the rollback file;
// writes to the 18 legacy archived rows between 76 and 76b; 76b's release-order check with and without its override);
// nothing here touches a database or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Line endings normalised, so the checks read the same on a Windows checkout (CRLF) and in CI (LF).
const read = name => fs.readFileSync(path.join(ROOT, 'db/changes', name), 'utf8').replace(/\r\n/g, '\n');
const forward = read('76-property-archive.forward.sql');
const rollback = read('76-property-archive.rollback.sql');
const backfill = read('76b-property-archive-backfill-20261110.sql');

// Every CREATE OR REPLACE FUNCTION statement, by qualified name, up to its closing «$function$;».
function functions(sql) {
  const out = new Map();
  const re = /CREATE OR REPLACE FUNCTION ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\$function\$;/g;
  let m;
  while ((m = re.exec(sql))) out.set(m[1], m[0]);
  return out;
}
const fns = functions(forward);
const fn = name => {
  assert(fns.has(name), 'missing function ' + name);
  return fns.get(name);
};

const DEFINER = [
  'crm_repair_private.property_archive_state',
  'crm_repair_private.property_archive_caller',
  'crm_repair_private.archive_property_internal',
  'public.crm_property_archive_precheck',
  'public.crm_archive_property',
  'public.crm_restore_property',
  'public.crm_expire_listing_agreements',
];
const GUARD = 'crm_repair_private.guard_property_archive_columns';

// Column names of a view body, in order (one column per line, as written in these files).
function viewColumns(block) {
  const cols = [];
  const re = /^\s*(?:SELECT )?t\.([a-z_]+),?\r?$|^\s*END AS ([a-z_]+),?\r?$/gm;
  let m;
  while ((m = re.exec(block))) cols.push(m[1] || m[2]);
  return cols;
}
function viewBlock(sql, head) {
  const start = sql.indexOf(head);
  assert(start >= 0, 'missing ' + head);
  return sql.slice(start, sql.indexOf(';', start) + 1);
}
const NEW_COLUMNS = ['archive_reason', 'archive_note', 'archive_source', 'archive_evidence', 'relisted_at'];

test('SQL76 creates exactly the expected functions and each pins search_path to empty', () => {
  assert.deepEqual([...fns.keys()].sort(), [...DEFINER, GUARD].sort());
  for (const [name, text] of fns) assert(text.includes("SET search_path TO ''"), name);
});

test('the RPCs, the internal write and the expiry job are SECURITY DEFINER; the client-write guard is not', () => {
  for (const name of DEFINER) assert(/\n SECURITY DEFINER\n/.test(fn(name)), name);
  assert(!fn(GUARD).includes('SECURITY DEFINER'));
  assert(fn(GUARD).includes("IF current_user NOT IN ('authenticated', 'anon') THEN RETURN new; END IF;"));
  assert(fn(GUARD).includes("RAISE EXCEPTION 'property_archive_use_rpc'"));
  assert(forward.includes('CREATE TRIGGER crm_guard_property_archive\n  BEFORE INSERT OR UPDATE OF archived, archived_at, archived_by, archive_reason, archive_note, archive_source, archive_evidence, relisted_at\n  ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_property_archive_columns();'));
});

test('execute grants: RPCs for authenticated and service role, the expiry job and private helpers revoked from clients', () => {
  const rpcs = [
    'public.crm_property_archive_precheck(uuid)',
    'public.crm_archive_property(uuid, text, text, boolean)',
    'public.crm_restore_property(uuid, boolean, date, integer, numeric, text)',
  ];
  for (const sig of rpcs) {
    assert(forward.includes('REVOKE ALL ON FUNCTION ' + sig + ' FROM PUBLIC, anon;'), sig);
    assert(forward.includes('GRANT EXECUTE ON FUNCTION ' + sig + ' TO authenticated, service_role;'), sig);
  }
  assert(forward.includes('REVOKE ALL ON FUNCTION public.crm_expire_listing_agreements() FROM PUBLIC, anon, authenticated;'));
  assert(forward.includes('GRANT EXECUTE ON FUNCTION public.crm_expire_listing_agreements() TO service_role;'));
  for (const sig of [
    'crm_repair_private.guard_property_archive_columns()',
    'crm_repair_private.property_archive_state(uuid)',
    'crm_repair_private.property_archive_caller(uuid)',
    'crm_repair_private.archive_property_internal(uuid, text, text, text, jsonb, boolean)',
  ]) assert(forward.includes('REVOKE ALL ON FUNCTION ' + sig + ' FROM PUBLIC, anon, authenticated, service_role;'), sig);
  assert(!forward.includes('GRANT EXECUTE ON FUNCTION crm_repair_private.'));
  assert(!/GRANT[^;]*\banon\b/.test(forward));
});

test('the archive reasons are exactly the agreed list', () => {
  const start = forward.indexOf('INSERT INTO public.property_archive_reasons');
  const block = forward.slice(start, forward.indexOf('ON CONFLICT (code)', start));
  const rows = [...block.matchAll(/\('([a-z_]+)', '([^']+)', '([a-z_]+)', (true|false), (true|false), (\d+)\)/g)]
    .map(m => [m[1], m[2], m[3], m[4] === 'true', m[5] === 'true']);
  assert.deepEqual(rows, [
    ['contract_expired', 'انتهى عقد التسويق', 'withdrawn', true, false],
    ['owner_withdrew', 'المالك سحب العقار', 'withdrawn', true, false],
    ['sold_by_owner', 'المالك باعه بنفسه أو عن طريق غيرنا', 'sold', true, false],
    ['sold_by_us', 'انباع عن طريقنا', 'sold', true, false],
    ['rented', 'انأجر', 'not_available', true, false],
    ['duplicate', 'سجل مكرر', 'not_available', true, true],
    ['test_record', 'سجل تجريبي أو خطأ إدخال', 'not_available', true, false],
    ['other', 'سبب آخر', 'not_available', true, true],
    ['unrecorded', 'سبب الأرشفة غير مسجل', 'not_available', false, false],
  ]);
  assert(forward.includes("status_after text NOT NULL CHECK (status_after IN ('sold', 'withdrawn', 'not_available'))"));
  assert(forward.includes('ON CONFLICT (code) DO UPDATE SET'));
  assert(forward.includes('REVOKE ALL ON public.property_archive_reasons FROM PUBLIC, anon, authenticated;'));
  assert(forward.includes('GRANT SELECT ON public.property_archive_reasons TO authenticated;'));
});

test('archived rows: reason required and never available, added by 76b after the backfill and validated at once', () => {
  // 76 adds only the source check. A CHECK applies to every UPDATE of a row, so the two archived-row rules added by 76
  // would refuse every write to the 18 legacy archived rows until 76b, and 77 and 77b are released between the two.
  assert(forward.includes("CHECK (archive_source IS NULL OR archive_source IN ('manual', 'agent', 'system', 'backfill'))"));
  assert(forward.includes('ADD COLUMN IF NOT EXISTS archive_reason text REFERENCES public.property_archive_reasons(code)'));
  assert(!forward.includes('ADD CONSTRAINT properties_archived_'));
  assert(!forward.includes('VALIDATE CONSTRAINT'));
  const hasReason = 'ADD CONSTRAINT properties_archived_has_reason_chk\n      CHECK (NOT coalesce(archived, false) OR archive_reason IS NOT NULL) NOT VALID;';
  const notAvailable = "ADD CONSTRAINT properties_archived_not_available_chk\n      CHECK (NOT coalesce(archived, false) OR status IS DISTINCT FROM 'available') NOT VALID;";
  const lastCheck = "WHERE coalesce(p.archived, false) AND (p.archive_reason IS NULL OR p.status IS NOT DISTINCT FROM 'available');";
  const at = s => {
    const i = backfill.indexOf(s);
    assert(i >= 0, 'missing in 76b: ' + s);
    return i;
  };
  // Inside 76b: the backfill, then the check that no archived row lacks a reason or is available, then the two rules
  // (NOT VALID), then their validation.
  assert(at('WITH reasoned AS (') < at(lastCheck));
  assert(at(lastCheck) < at(hasReason));
  assert(at(hasReason) < at(notAvailable));
  assert(at(notAvailable) < at('ALTER TABLE public.properties VALIDATE CONSTRAINT properties_archived_has_reason_chk;'));
  assert(at(notAvailable) < at('ALTER TABLE public.properties VALIDATE CONSTRAINT properties_archived_not_available_chk;'));
  // 76b's own «76 is applied» check no longer looks for the two rules: it adds them itself.
  const guard = backfill.slice(at('DO $backfill$'), at('CREATE TEMP TABLE sql76b_map'));
  assert(guard.includes("conname = 'properties_archive_source_chk'"));
  assert(!guard.includes('properties_archived_'));
});

test('crm_properties_access only gains the five columns, at the end; the rollback restores the old definition', () => {
  const after = viewBlock(forward, 'CREATE OR REPLACE VIEW public.crm_properties_access AS');
  const before = viewBlock(rollback, 'CREATE VIEW public.crm_properties_access AS');
  const newCols = viewColumns(after), oldCols = viewColumns(before);
  assert.equal(oldCols.length, 51);
  assert.equal(oldCols.at(-1), 'listing_purpose');
  assert.deepEqual(newCols, [...oldCols, ...NEW_COLUMNS]);
  const where = block => block.slice(block.indexOf('FROM public.properties t'));
  assert.equal(where(after), where(before));
  assert(where(after).includes('crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key)'));
  assert(forward.includes('GRANT SELECT (archive_reason, archive_note, archive_source, archive_evidence, relisted_at) ON public.properties TO authenticated;'));
  assert(rollback.includes('GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;'));
});

test('history: read through company and branch access, owner-only investment isolation, no client writes', () => {
  assert(forward.includes("action text NOT NULL CHECK (action IN ('archive', 'restore', 'reason_set'))"));
  assert(forward.includes('ALTER TABLE public.property_archive_events ENABLE ROW LEVEL SECURITY;'));
  assert(forward.includes('CREATE POLICY property_archive_events_read ON public.property_archive_events FOR SELECT TO authenticated'));
  assert(forward.includes('AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)));'));
  assert(forward.includes('CREATE POLICY investment_owner_only ON public.property_archive_events AS RESTRICTIVE FOR ALL TO authenticated'));
  assert(forward.includes('REVOKE ALL ON public.property_archive_events FROM PUBLIC, anon, authenticated;'));
  assert(forward.includes('GRANT SELECT ON public.property_archive_events TO authenticated;'));
  assert(!/CREATE POLICY [a-z_]+ ON public\.property_archive_events FOR (INSERT|UPDATE|DELETE|ALL)/.test(forward));
});

test('archive write: status in the same UPDATE, sold stays sold, active deal blocks, only the owner forces', () => {
  const internal = fn('crm_repair_private.archive_property_internal');
  assert(internal.includes("v_status_after := CASE WHEN v_prop.status = 'sold' THEN 'sold' ELSE v_reason.status_after END;"));
  assert(/UPDATE public\.properties t SET\s+archived = true,[\s\S]*?status = v_status_after,[\s\S]*?WHERE t\.id = v_prop\.id;/.test(internal));
  assert(internal.includes("IF v_source <> 'manual' OR public.my_role() IS DISTINCT FROM 'owner' THEN\n    v_force := false;"));
  assert(internal.includes("RETURN jsonb_build_object('ok', false, 'blocked', 'active_deal'"));
  assert(internal.includes("'status_after', v_prop.status, 'archived', coalesce(v_prop.archived, false), 'archive_reason', v_prop.archive_reason,"));
  assert(internal.includes("IF NOT v_reason.manual_selectable THEN RAISE EXCEPTION 'archive_reason_not_selectable'"));
  assert(internal.includes("IF v_reason.note_required AND v_note IS NULL THEN RAISE EXCEPTION 'archive_note_required'"));
  assert(internal.includes("'[archive] أرشفة العقار: '"));
  assert(internal.includes("|| coalesce(v_prop.title, 'عقار') || ' — ' || v_reason.label_ar"));
  assert(internal.includes('INSERT INTO public.property_archive_events'));
  assert(internal.includes('INSERT INTO public.activities'));
  const state = fn('crm_repair_private.property_archive_state');
  assert(state.includes("WHERE o.stage IN ('negotiation', 'deposit', 'awaiting_finance', 'finance_approved', 'awaiting_clearance', 'ownership_transfer')"));
  assert(state.includes("coalesce(p.status, '') IN ('reserved', 'deposit', 'negotiating')"));
  assert(state.includes("(to_jsonb(d) ->> 'merged_into_deal_id') IS NULL"));
  assert(state.includes("AND v.status IN ('scheduled', 'confirmed', 'postponed')"));
  const rpc = fn('public.crm_archive_property');
  assert(rpc.includes("archive_property_internal(p_property, p_reason, p_note, 'agent', NULL, false)"));
  assert(rpc.includes("archive_property_internal(p_property, p_reason, p_note, 'manual', NULL, v_role = 'owner' AND coalesce(p_force, false))"));
  const caller = fn('crm_repair_private.property_archive_caller');
  assert(caller.includes("v_role NOT IN ('owner', 'manager', 'agent')"));
  assert(caller.includes('OR NOT crm_repair_private.staff_can_access_branch(v_company, v_prop.branch_key)'));
  assert(caller.includes('OR NOT crm_repair_private.investment_row_allowed(v_company, v_prop.row_data)'));
  assert(fn('public.crm_property_archive_precheck').includes("jsonb_build_object('ok', true, 'can_force', v_role = 'owner')"));
});

test('restore is a new contract: available, archive columns cleared, new agreement or none, relisted_at, logged', () => {
  const restore = fn('public.crm_restore_property');
  for (const s of ["status = 'available',", 'archived = false,', 'archived_at = NULL,', 'archived_by = NULL,', 'archive_reason = NULL,',
    'archive_note = NULL,', 'archive_source = NULL,', 'archive_evidence = NULL,', 'relisted_at = now(),', 'has_listing_agreement = v_has,',
    'price = coalesce(p_price, t.price),', "RAISE EXCEPTION 'property_not_archived'", "RAISE EXCEPTION 'property_has_completed_deal'",
    "RAISE EXCEPTION 'property_has_active_reservation'", "'[restore] استعادة العقار كعقد جديد: '", "'restore', v_prop.archive_reason"])
    assert(restore.includes(s), s);
  // A new agreement that already ended would be archived again the next morning: refused.
  assert(restore.includes("IF (v_start + make_interval(months => v_months))::date < (now() AT TIME ZONE 'Asia/Muscat')::date THEN\n      RAISE EXCEPTION 'agreement_already_ended'"));
  // The monitoring window starts again at the relisting and never moves backward; the old value stays in the history.
  assert(restore.includes('performance_tracking_started_at = greatest(t.performance_tracking_started_at, now()),'));
  assert(restore.includes("'tracking_started_before', v_prop.performance_tracking_started_at"));
  assert(!/created_at\s*=/.test(restore));
});

test('a manual archive has a signed-in user; force and changing a recorded reason are the owner\'s alone', () => {
  const internal = fn('crm_repair_private.archive_property_internal');
  assert(internal.includes("IF v_source NOT IN ('manual', 'agent', 'system') OR (v_source = 'manual' AND v_actor IS NULL) THEN\n    RAISE EXCEPTION 'archive_source_invalid'"));
  assert(internal.includes("IF v_action = 'reason_set' AND v_source = 'manual' AND public.my_role() IS DISTINCT FROM 'owner' THEN\n    RAISE EXCEPTION 'not_authorized'"));
  // The reason check runs before the active-deal check, so a branch account learns nothing more about the deals.
  assert(internal.indexOf("RAISE EXCEPTION 'not_authorized'") < internal.indexOf('v_state := crm_repair_private.property_archive_state(v_prop.id);'));
  assert(internal.includes("archived_at = CASE WHEN v_action = 'archive' THEN now() ELSE t.archived_at END,"));
  assert(internal.includes("archived_by = CASE WHEN v_action = 'archive' THEN v_actor ELSE t.archived_by END,"));
  // Every caller of the internal write passes its source explicitly; only the expiry job uses 'system'.
  assert.equal((forward.match(/archive_property_internal\([^)]*'system'/g) || []).length, 1);
  assert(fn('public.crm_expire_listing_agreements').includes("'system',\n                   jsonb_build_object('agreement_end_date'"));
});

test('SQL76 refuses a changed view; 76 and 76b are separate migrations, released 76 -> 77 -> 77b -> 76b', () => {
  assert(forward.includes("PERFORM set_config('search_path', 'public', true);\n  v_def := pg_get_viewdef('public.crm_properties_access'::regclass, true);"));
  assert(forward.includes("IF md5(v_def) <> 'e64c33f86254270ca1a13670191c9253' AND position('archive_reason' IN v_def) = 0 THEN"));
  assert(forward.includes("OR to_regprocedure('auth.role()') IS NULL THEN"));
  const order = 'Release order (10 Nov 2026), each file as its own migration: 76 -> 77 -> 77b -> 76b (then 77c, 78).';
  assert(forward.includes(order));
  assert(backfill.includes(order));
  assert(!/one transaction|same transaction/i.test(forward + backfill));
  // 76b backfills only after 77b (a merged card exists), unless the release says otherwise on purpose. The check reads
  // merged_into_deal_id through to_jsonb, so it also works before 77 added the column; a second run (nothing to
  // backfill) does not need it.
  const check = "IF coalesce(current_setting('crm.sql76b_without_sql77b', true), '') <> 'yes'\n"
    + "       AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE (to_jsonb(d) ->> 'merged_into_deal_id') IS NOT NULL) THEN\n"
    + "      RAISE EXCEPTION 'SQL76b refused: release order is 76 -> 77 -> 77b -> 76b and 77b has not run (no merged card)";
  const i = backfill.indexOf(check);
  assert(i >= 0, 'missing the release-order check in 76b');
  assert(i > backfill.indexOf('IF v_done = 18 THEN') && i < backfill.indexOf('WITH moved AS ('));
});

test('activity rows point at the history row as archive_event_id (event_id means public.events to the investment check)', () => {
  const internal = fn('crm_repair_private.archive_property_internal');
  const restore = fn('public.crm_restore_property');
  for (const body of [internal, restore]) {
    assert(body.includes("'entity_type', 'property', 'entity_id', v_prop.id, 'archive_event_id', v_event,"));
    assert(!body.includes("'event_id'"));
  }
});

test('expiry job: available agreements ended before today (Muscat), hold on active deal or coming viewing, one alert', () => {
  const job = fn('public.crm_expire_listing_agreements');
  for (const s of ["v_today date := (now() AT TIME ZONE 'Asia/Muscat')::date;", 'WHERE coalesce(p.archived, false) = false',
    'AND p.has_listing_agreement IS TRUE', 'AND p.agreement_end_date < v_today', "AND p.status = 'available'",
    "coalesce((v_state ->> 'active_deal')::boolean, false) OR coalesce((v_state ->> 'upcoming_viewings')::integer, 0) > 0",
    "'agreement_expired_held:' || r.agreement_end_date::text", "'agreement_expired_archived:' || r.agreement_end_date::text",
    'ON CONFLICT (kind, ref_id) DO NOTHING;', 'INSERT INTO public.notifications (user_id, type, is_read, link, title, body)',
    "archive_property_internal(r.id, 'contract_expired',", "'system',", 'EXCEPTION WHEN OTHERS THEN'])
    assert(job.includes(s), s);
  assert(forward.includes("ELSIF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_expire_listing_agreements_daily') THEN"));
  assert(forward.includes("PERFORM cron.schedule('crm_expire_listing_agreements_daily', '0 6 * * *', 'select public.crm_expire_listing_agreements()');"));
});

test('no outbound call, deal write or customer message in these files', () => {
  for (const [name, sql] of [['forward', forward], ['rollback', rollback], ['backfill', backfill]]) {
    assert(!/net\.http_post/.test(sql), name);
    assert(!/(UPDATE|INSERT INTO|DELETE FROM) public\.(deals|viewings|whatsapp_[a-z_]+)\b/.test(sql), name);
    assert(!/\+968|\b968\d{8}\b|\b[79]\d{7}\b/.test(sql), name + ' contains something like a phone number');
  }
});

test('rollback drops everything SQL76 added', () => {
  for (const name of fns.keys()) assert(rollback.includes('DROP FUNCTION IF EXISTS ' + name + '('), name);
  for (const s of ['DROP TRIGGER IF EXISTS crm_guard_property_archive ON public.properties;',
    'DROP TABLE IF EXISTS public.property_archive_events;', 'DROP TABLE IF EXISTS public.property_archive_reasons;',
    'DROP CONSTRAINT IF EXISTS properties_archived_has_reason_chk', 'DROP CONSTRAINT IF EXISTS properties_archived_not_available_chk',
    'DROP CONSTRAINT IF EXISTS properties_archive_source_chk', "PERFORM cron.unschedule('crm_expire_listing_agreements_daily');",
    'DROP VIEW IF EXISTS public.crm_properties_access;'])
    assert(rollback.includes(s), s);
  for (const col of NEW_COLUMNS) assert(rollback.includes('DROP COLUMN IF EXISTS ' + col), col);
  assert(rollback.indexOf('CREATE VIEW public.crm_properties_access') < rollback.indexOf('DROP COLUMN IF EXISTS archive_reason'));
  assert(rollback.includes("current_setting('crm.sql76_rollback_drop_history', true)"));
});

test('76b backfill: the 18 archived properties, evidence-only reasons, 14 leave available, 4 keep their status', () => {
  const rows = new Map([...backfill.matchAll(/\('([0-9a-f-]{36})', '([a-z_]+)', '([a-z_]+)', '([a-z_]+)',/g)]
    .map(m => [m[1], [m[2], m[3], m[4]]]));
  const expected = {
    'dd95be18-651e-42fe-a105-837cafdac6fb': ['available', 'not_available', 'test_record'],
    'cde048c6-9b2b-4643-aa80-48a3dc19c902': ['available', 'not_available', 'duplicate'],
    '12bc5654-0366-44e2-83a7-f181bdb01215': ['available', 'withdrawn', 'contract_expired'],
    '9457b323-1e4f-4a08-92e8-43e2e15ed5f1': ['available', 'withdrawn', 'contract_expired'],
    '473b069f-e984-4cd9-a883-6c854009dc7c': ['available', 'withdrawn', 'contract_expired'],
    '26c1d6fe-7e04-4110-be31-4fcd9d3c9b6a': ['available', 'not_available', 'unrecorded'],
    'efecf711-b07a-4886-b54d-17e7d2e2740c': ['available', 'not_available', 'unrecorded'],
    'fe4447be-2d7d-40f8-8333-e0bcb961112a': ['available', 'not_available', 'unrecorded'],
    'a70d1b5c-2feb-4e96-9b31-92369fb84c6f': ['available', 'not_available', 'unrecorded'],
    '4762184c-f46d-48c5-acf8-03de06bbd97f': ['available', 'not_available', 'unrecorded'],
    'f25ee48b-046b-4f3d-8bb2-55d97af33dd8': ['available', 'not_available', 'unrecorded'],
    '5993b611-f808-41ae-9286-73c00a5b1c96': ['available', 'not_available', 'unrecorded'],
    '1b2aed39-e91a-4337-9c0e-336a7fc662e9': ['available', 'not_available', 'unrecorded'],
    'b58f9074-3fd4-47e8-b31f-9ed9d829e863': ['available', 'not_available', 'unrecorded'],
    '666b4302-3740-4c9e-bc65-b92d5b71fdd4': ['sold', 'sold', 'sold_by_owner'],
    'f99087b9-03a1-4245-a3bf-4c21f327f77f': ['reserved', 'reserved', 'unrecorded'],
    'e1c81d62-cd1a-49fa-ada2-7bdc27408530': ['withdrawn', 'withdrawn', 'unrecorded'],
    '40b767af-4b96-42e0-9d4e-5322f99f2022': ['withdrawn', 'withdrawn', 'unrecorded'],
  };
  assert.deepEqual(Object.fromEntries(rows), expected);
  assert(backfill.includes("'نسخة مكررة من 473b069f'"));
  assert(backfill.includes("'غير متاح بقرار أحمد 9 نوفمبر، مو مباع'"));
  assert(backfill.includes('8e763406-22aa-43e1-9863-4a124b974ba4') && backfill.includes('84b308ac-262e-4e6c-bfad-0668fa566ac5'));
  assert(backfill.includes('IF v_moved <> 14 THEN') && backfill.includes('IF v_reasoned <> 4 THEN'));
  assert(backfill.includes("'archive', moved.reason, moved.note, 'backfill'") && backfill.includes('coalesce(moved.archived_at, now())'));
  assert(backfill.includes('moved.archived_by, coalesce(moved.archived_at, now())'));
  assert(!/archived_at\s*=|archived_by\s*=|archived\s*=\s*true/.test(backfill.replace(/--[^\n]*/g, '')));
  const reasoned = backfill.slice(backfill.indexOf('WITH reasoned AS ('), backfill.indexOf('RETURNING p.id, p.company_id, p.archived_at, p.archived_by, p.status'));
  const reasonSet = reasoned.slice(reasoned.indexOf(' SET '), reasoned.indexOf(' FROM pg_temp.sql76b_map m'));
  assert(reasonSet.includes('archive_reason = m.reason') && !/\bstatus\s*=/.test(reasonSet));
  const moved = backfill.slice(backfill.indexOf('WITH moved AS ('), backfill.indexOf('WITH reasoned AS ('));
  assert(moved.includes('SET status = m.status_after, archive_reason = m.reason'));
});
