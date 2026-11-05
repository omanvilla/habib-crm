'use strict';
// SQL68: the owner's private WhatsApp line (route_key 'owner'). Synthetic tests of
// the real Edge handlers and UI code. Every external fetch is denied or answered by
// a local fake; no live token, customer or Meta call is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.join(__dirname, '..');
const COMPANY = 'TEST-company', OWNER = 'TEST-owner', MANAGER = 'TEST-manager', AGENT = 'TEST-agent';
const OWNER_PNID = '30001', MUSCAT_PNID = '10001', BARKA_PNID = '20001';
const source = name => fs.readFileSync(path.join(ROOT, 'supabase/functions', name, 'index.ts'), 'utf8');

function baseRows() {
  return {
    profiles: [
      { id: OWNER, company_id: COMPANY, role: 'owner', is_active: true, full_name: 'TEST owner', phone: null },
      { id: MANAGER, company_id: COMPANY, role: 'manager', is_active: true, full_name: 'TEST manager', phone: null },
      { id: AGENT, company_id: COMPANY, role: 'agent', is_active: true, full_name: 'TEST agent', phone: null },
    ],
    company_lead_routes: [
      { id: 'TEST-route-muscat', company_id: COMPANY, route_key: 'muscat', assigned_to: MANAGER, is_active: true, meta_phone_number_id: MUSCAT_PNID, whatsapp_number: '+96800000001', owner_only_inbox: false },
      { id: 'TEST-route-barka', company_id: COMPANY, route_key: 'barka', assigned_to: AGENT, is_active: true, meta_phone_number_id: BARKA_PNID, whatsapp_number: '+96800000002', owner_only_inbox: false },
      { id: 'TEST-route-investment', company_id: COMPANY, route_key: 'investment', assigned_to: OWNER, is_active: true, meta_phone_number_id: null, whatsapp_number: null, transport_route_key: 'muscat', owner_only_inbox: true },
      { id: 'TEST-route-owner', company_id: COMPANY, route_key: 'owner', assigned_to: OWNER, is_active: true, meta_phone_number_id: OWNER_PNID, meta_waba_id: 'TEST-waba-owner', whatsapp_number: '+96890944469', owner_only_inbox: true },
    ],
    whatsapp_conversations: [
      { id: 'TEST-conv-owner', company_id: COMPANY, client_id: null, route_key: 'owner', assigned_to: OWNER, meta_phone_number_id: OWNER_PNID, customer_wa_id: '96811110001', customer_phone: '+96811110001', last_message_at: '2026-11-05T10:00:00Z' },
      { id: 'TEST-conv-muscat', company_id: COMPANY, client_id: 'TEST-client', route_key: 'muscat', assigned_to: MANAGER, meta_phone_number_id: MUSCAT_PNID, customer_wa_id: '96811110001', customer_phone: '+96811110001', last_message_at: '2026-11-05T09:00:00Z' },
    ],
    whatsapp_messages: [
      { id: 'TEST-msg-owner', company_id: COMPANY, conversation_id: 'TEST-conv-owner', client_id: null, direction: 'inbound', message_type: 'image', media_id: '123456', body: 'TEST private' },
    ],
    clients: [{ id: 'TEST-client', company_id: COMPANY, phone: '+96811110001', lead_route: 'muscat' }],
    client_requests: [], whatsapp_automation_events: [], whatsapp_onboarding_events: [], whatsapp_route_credentials: [],
    whatsapp_webhook_events: [], activities: [],
  };
}

// A small PostgREST-like fake. It records every call so tests can assert what the
// handler asked for. It does not model RLS: the SQL fixture tests that separately.
function fakeDb(rows, calls, writes, rpc) {
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: db.userId } }, error: null }) },
    rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return rpc(fn, args); },
    from(table) {
      if (!Object.hasOwn(rows, table)) throw new Error('Forbidden unexpected table access: ' + table);
      const call = { table, operation: 'select', filters: [] }, predicates = [];
      const q = {
        select(columns) { call.columns = columns; return q; },
        eq(k, v) { call.filters.push(['eq', k, v]); predicates.push(r => r[k] === v); return q; },
        neq(k, v) { call.filters.push(['neq', k, v]); predicates.push(r => r[k] !== v); return q; },
        is(k, v) { call.filters.push(['is', k, v]); predicates.push(r => r[k] == v); return q; },
        in(k, v) { call.filters.push(['in', k, v]); predicates.push(r => v.includes(r[k])); return q; },
        not(k, op, v) {
          call.filters.push(['not', k, op, v]);
          if (op === 'is') predicates.push(r => r[k] != null);
          else if (op === 'in') { const list = String(v).replace(/^\(|\)$/g, '').split(','); predicates.push(r => !list.includes(String(r[k]))); }
          return q;
        },
        or(e) { call.filters.push(['or', e]); return q; },
        order() { return q; }, range(a, b) { call.range = [a, b]; return q; }, limit(n) { call.limit = n; return q; },
        single() { call.single = true; return q; }, maybeSingle() { call.single = true; return q; },
        update(p) { call.operation = 'update'; call.patch = structuredClone(p); return q; },
        insert(p) { call.operation = 'insert'; call.patch = structuredClone(p); return q; },
        upsert(p) { call.operation = 'upsert'; call.patch = structuredClone(p); return q; },
        then(resolve, reject) {
          calls.push(call);
          let m = rows[table].filter(r => predicates.every(p => p(r)));
          if (call.limit) m = m.slice(0, call.limit);
          if (call.operation === 'update') { writes.push(call); m.forEach(r => Object.assign(r, call.patch)); }
          if (call.operation === 'insert' && table === 'whatsapp_messages' && rows[table].some(r => r.whatsapp_message_id && r.whatsapp_message_id === call.patch.whatsapp_message_id))
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(resolve, reject);
          if (['insert', 'upsert'].includes(call.operation)) {
            writes.push(call);
            const row = { id: 'TEST-new-' + table + '-' + rows[table].length, ...call.patch };
            rows[table].push(row); m = [row];
          }
          return Promise.resolve({ data: structuredClone(call.single ? m[0] || null : m), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return db;
}

function runtime(name, { userId = OWNER, rows = baseRows(), fetchImpl = null } = {}) {
  const calls = [], writes = [], fetches = [], pending = [];
  const rpc = (fn, args) => {
    if (fn === 'resolve_whatsapp_route') return { data: rows.company_lead_routes.filter(r => r.meta_phone_number_id === args.p_meta_phone_number_id && r.is_active), error: null };
    if (fn === 'crm_whatsapp_inbox_counts') return { data: { unread_total: 0, handoff_total: 0 }, error: null };
    if (fn === 'crm_whatsapp_latest_messages') return { data: [], error: null };
    throw new Error('Unexpected RPC: ' + fn);
  };
  const db = fakeDb(rows, calls, writes, rpc); db.userId = userId;
  const ctx = {
    Deno: { env: { get: k => k === 'CRM_COMPANY_ID' ? COMPANY : 'TEST-not-a-credential' }, serve: h => { ctx.handler = h; } },
    EdgeRuntime: { waitUntil: p => pending.push(p) },
    createClient: () => db, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal,
    crypto: crypto.webcrypto, btoa, atob, setTimeout, clearTimeout, console: { error() {}, log() {}, warn() {} },
    fetch: async (...args) => { fetches.push(args); if (fetchImpl) return fetchImpl(...args); throw new Error('External network is forbidden in tests'); },
  };
  vm.createContext(ctx);
  const code = source(name).replace(/^import\s[^\n]+;\s*$/mg, '');
  vm.runInContext(stripTypeScriptTypes(code), ctx, { filename: name + '.ts' });
  const jwt = 'x.' + Buffer.from(JSON.stringify({ sub: userId })).toString('base64url') + '.y';
  async function invoke(body = {}) {
    const res = await ctx.handler(new Request('https://test.invalid/fn', { method: 'POST', headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  }
  return { ctx, rows, calls, writes, fetches, pending, invoke };
}

// ---------- Linking: investment still refused, owner route for the owner only ----------
for (const name of ['whatsapp-embedded-signup', 'whatsapp-direct-bind']) {
  test(`${name}: investment is still refused for its own number`, async () => {
    const f = runtime(name, { userId: OWNER });
    const r = await f.invoke({ route_key: 'investment', code: 'TEST-only', user_access_token: 'TEST-only' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'investment_uses_muscat'); assert.equal(r.body.transport_route_key, 'muscat');
    assert(f.calls.every(c => c.table === 'profiles')); assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
  });
  test(`${name}: manager cannot link the owner route`, async () => {
    const f = runtime(name, { userId: MANAGER });
    const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', user_access_token: 'TEST-only' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'owner_required');
    assert(f.calls.every(c => c.table === 'profiles')); assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
  });
  test(`${name}: agent cannot link the owner route`, async () => {
    const f = runtime(name, { userId: AGENT });
    const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', user_access_token: 'TEST-only' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'owner_or_manager_required'); assert.equal(f.fetches.length, 0);
  });
  test(`${name}: owner route is accepted for the owner and reaches its own route row`, async () => {
    const rows = baseRows(); rows.company_lead_routes = rows.company_lead_routes.filter(r => r.route_key !== 'owner');
    const f = runtime(name, { userId: OWNER, rows });
    const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', user_access_token: 'TEST-only' });
    assert.equal(r.status, 404); assert.equal(r.body.error, 'route_not_found');
    const lookup = f.calls.find(c => c.table === 'company_lead_routes');
    assert(lookup.filters.some(x => x[0] === 'eq' && x[1] === 'route_key' && x[2] === 'owner'));
    assert.equal(f.fetches.length, 0);
  });
  test(`${name}: unknown routes stay invalid`, async () => {
    const f = runtime(name, { userId: OWNER });
    const r = await f.invoke({ route_key: 'general', code: 'TEST-only' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_route');
  });
}

function fakeMeta(displayNumber, { syncFails = false } = {}) {
  return async url => {
    if (String(url).includes('/smb_app_data')) return new Response(JSON.stringify(syncFails ? { error: { message: 'TEST onboarding window expired' } } : { success: true, request_id: 'TEST-req' }), { status: syncFails ? 400 : 200 });
    const u = String(url), body = d => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/oauth/access_token')) return body({ access_token: 'TEST-business-token' });
    if (u.includes('/debug_token')) return body({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['TEST-waba-owner'] }] } });
    if (u.includes('/phone_numbers')) return body({ data: [{ id: 'TEST-phone', display_phone_number: displayNumber, verified_name: 'TEST' }] });
    if (u.includes('/subscribed_apps')) return body({ success: true });
    return body({ id: 'TEST' });
  };
}
test('embedded signup never binds another number to the owner route', async () => {
  const rows = baseRows(); Object.assign(rows.company_lead_routes.find(r => r.route_key === 'owner'), { meta_phone_number_id: null, is_active: false });
  const f = runtime('whatsapp-embedded-signup', { userId: OWNER, rows, fetchImpl: fakeMeta('+968 0000 0001') });
  const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', session_info: {} });
  assert.equal(r.status, 500); assert.match(r.body.message, /owner_route_number_mismatch/);
  assert(!f.writes.some(w => w.table === 'company_lead_routes'));
  assert(!f.fetches.some(([u]) => String(u).includes('subscribed_apps')));
});
test('embedded signup links the owner line and keeps its activity owner-only', async () => {
  const rows = baseRows(); Object.assign(rows.company_lead_routes.find(r => r.route_key === 'owner'), { meta_phone_number_id: null, is_active: false });
  const f = runtime('whatsapp-embedded-signup', { userId: OWNER, rows, fetchImpl: fakeMeta('+968 9094 4469') });
  const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', session_info: {} });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.route_key, 'owner');
  const route = rows.company_lead_routes.find(x => x.route_key === 'owner');
  assert.equal(route.meta_phone_number_id, 'TEST-phone'); assert.equal(route.is_active, true);
  assert.equal(rows.company_lead_routes.find(x => x.route_key === 'muscat').meta_phone_number_id, MUSCAT_PNID);
  const activity = rows.activities.at(-1); assert.equal(activity.after_data.route_key, 'owner');
  assert.equal(rows.whatsapp_onboarding_events.at(-1).route_key, 'owner');
});

// ---------- Webhook: the owner line is private capture only ----------
function envelope(pnid) { return { metadata: { phone_number_id: pnid }, contacts: [{ wa_id: '96811110009', profile: { name: 'TEST contact' } }] }; }
test('webhook stores an owner-line message without CRM identity, extraction or agent', async () => {
  const f = runtime('whatsapp-webhook');
  await f.ctx.processInboundMessage(envelope(OWNER_PNID), { id: 'wamid.TEST-1', from: '96811110009', timestamp: '1793900000', type: 'text', text: { body: 'TEST hello' } });
  assert.deepEqual(f.calls.filter(c => c.rpc).map(c => c.rpc), ['resolve_whatsapp_route']);
  const conv = f.rows.whatsapp_conversations.at(-1);
  assert.equal(conv.route_key, 'owner'); assert.equal(conv.client_id, null); assert.equal(conv.assigned_to, OWNER); assert.equal(conv.meta_phone_number_id, OWNER_PNID);
  const msg = f.rows.whatsapp_messages.at(-1);
  assert.equal(msg.conversation_id, conv.id); assert.equal(msg.client_id, null); assert.equal(msg.direction, 'inbound'); assert.equal(msg.body, 'TEST hello');
  assert(!f.calls.some(c => ['clients', 'client_requests', 'activities'].includes(c.table)));
  assert.equal(f.fetches.length, 0);
});
test('webhook records the owner\'s own phone replies (coexistence echoes) without counting them as CRM work', async () => {
  const f = runtime('whatsapp-webhook');
  await f.ctx.processOutboundEcho(envelope(OWNER_PNID), { id: 'wamid.TEST-2', from: '96890944469', to: '96811110001', timestamp: '1793900001', type: 'text', text: { body: 'TEST reply' } });
  const msg = f.rows.whatsapp_messages.at(-1);
  assert.equal(msg.conversation_id, 'TEST-conv-owner'); assert.equal(msg.client_id, null); assert.equal(msg.direction, 'outbound');
  assert.equal(msg.channel_source, 'owner_private_app');
  assert(!f.calls.some(c => c.rpc && c.rpc !== 'resolve_whatsapp_route')); assert.equal(f.fetches.length, 0);
});
test('webhook refuses to reuse a non-owner conversation on the owner line', async () => {
  const rows = baseRows(); rows.whatsapp_conversations[0].route_key = 'muscat';
  const f = runtime('whatsapp-webhook', { rows });
  await assert.rejects(f.ctx.processInboundMessage(envelope(OWNER_PNID), { id: 'wamid.TEST-3', from: '96811110001', timestamp: '1793900002', type: 'text', text: { body: 'TEST' } }), /owner_private_conversation_mismatch/);
  assert(!f.writes.some(w => w.table === 'whatsapp_messages'));
});
test('Muscat messages still go through the business-route resolver (investment design unchanged)', async () => {
  const f = runtime('whatsapp-webhook');
  await assert.rejects(f.ctx.processInboundMessage(envelope(MUSCAT_PNID), { id: 'wamid.TEST-4', from: '96811110001', timestamp: '1793900003', type: 'text', text: { body: 'TEST' } }), /Unexpected RPC: crm_resolve_whatsapp_business_route/);
});

// ---------- Inbox: staff never see owner-route conversations ----------
for (const userId of [MANAGER, AGENT]) {
  test(`${userId} inbox list excludes the owner route and cannot open its conversation or media`, async () => {
    const f = runtime('whatsapp-inbox', { userId });
    const list = await f.invoke({ action: 'list' });
    assert.equal(list.status, 200);
    assert(!list.body.conversations.some(c => c.route_key === 'owner'));
    const listCall = f.calls.find(c => c.table === 'whatsapp_conversations' && c.range);
    const hidden = listCall.filters.find(x => x[0] === 'not' && x[1] === 'route_key');
    assert(hidden && String(hidden[3]).includes('owner') && String(hidden[3]).includes('investment'));
    for (const action of ['messages', 'media', 'media_stream']) {
      const r = await f.invoke({ action, conversation_id: 'TEST-conv-owner', message_id: 'TEST-msg-owner' });
      assert.equal(r.status, 404, action); assert.equal(r.body.error, 'conversation_not_found');
    }
    assert(!f.calls.some(c => c.table === 'whatsapp_messages')); assert.equal(f.fetches.length, 0);
  });
}
test('owner opens owner-route messages and its media uses the owner line credentials', async () => {
  const f = runtime('whatsapp-inbox', { userId: OWNER });
  const list = await f.invoke({ action: 'list' });
  assert(list.body.conversations.some(c => c.route_key === 'owner'));
  const r = await f.invoke({ action: 'messages', conversation_id: 'TEST-conv-owner' });
  assert.equal(r.status, 200); assert.equal(r.body.client, null);
  const media = await f.invoke({ action: 'media', conversation_id: 'TEST-conv-owner', message_id: 'TEST-msg-owner' });
  assert.notEqual(media.body.error, 'media_credentials_unavailable');
  assert(f.calls.some(c => c.table === 'whatsapp_route_credentials' && c.filters.some(x => x[1] === 'route_key' && x[2] === 'owner')));
});

// ---------- Reply agent and other automation ----------
test('reply agent refuses the owner route and never mixes it into another conversation', () => {
  const s = fs.readFileSync(path.join(ROOT, 'supabase/functions/whatsapp-reply-agent/index.ts'), 'utf8');
  const gate = s.indexOf('if (conv.route_key === "owner") return fail("owner_private_route");');
  assert(gate > 0 && gate < s.indexOf('const tokens = await routeTokens(msg.company_id, conv.route_key);'));
  assert.match(s, /\.eq\("customer_wa_id", conv\.customer_wa_id\)\.neq\("id", conv\.id\)\.neq\("route_key", "owner"\)/);
  const send = fs.readFileSync(path.join(ROOT, 'supabase/functions/whatsapp-reply-send/index.ts'), 'utf8');
  assert.match(send, /if \(!\["barka", "muscat"\]\.includes\(conv\.route_key\)\) return json\(\{ ok: false, error: "route_blocked" \}, 409\);/);
  const backfill = fs.readFileSync(path.join(ROOT, 'supabase/functions/whatsapp-transcribe-backfill/index.ts'), 'utf8');
  assert.match(backfill, /\.neq\("whatsapp_conversations\.route_key", "owner"\)/);
});

// ---------- Migration text: reuses owner-only isolation, investment untouched ----------
test('SQL68 reuses the owner-only isolation and leaves the investment guards alone', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/changes/68-owner-private-route.forward.sql'), 'utf8');
  const mirrored = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261106090000_owner_private_route_20261106.sql'), 'utf8');
  assert.equal(sql, mirrored);
  assert.match(sql, /IF p_row->>'route_key'='owner' THEN RETURN true;END IF;/);
  assert.match(sql, /new\.owner_only_inbox := true;/);
  assert.match(sql, /AND c\.route_key IS DISTINCT FROM 'owner'/);
  for (const untouched of ['guard_shared_reception_route', 'guard_investment_route', 'resolve_shared_whatsapp_business_route', 'guard_shared_whatsapp_conversation'])
    assert(!new RegExp('CREATE OR REPLACE FUNCTION crm_repair_private\\.' + untouched + '\\b').test(sql), untouched);
  assert(!/DROP TRIGGER IF EXISTS a01_shared_reception_route/.test(sql));
  assert.match(sql, /'\+96890944469', false, true/);
  for (const t of ['client_requests', 'clients', 'appointments', 'properties']) assert(!new RegExp('ALTER TABLE public\\.' + t + '\\b').test(sql), t);
});

// ---------- Routes UI ----------
test('routes UI offers Meta linking for the owner line, read-only number, no public lead link', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app-base-v15.html'), 'utf8');
  assert.match(html, /\{key:'owner',label:'واتساب المالك',icon:'🔒'\}/);
  assert.match(html, /onclick="launchWhatsAppEmbeddedSignup\(\\'owner\\'\)">ربط \/ تحديث عبر Meta<\/button>/);
  assert.match(html, /\(investment\|\|ownerLine\?'readonly disabled':''\)/);
  assert.match(html, /\(ownerLine\?'':'<div class="share-link-input"/);
  assert.match(html, /owner:'🔒 واتساب المالك'/);
  const ui = fs.readFileSync(path.join(ROOT, 'whatsapp-direct-bind-ui.js'), 'utf8');
  assert.match(ui, /var keys=\['muscat','barka','investment','owner'\];/);
});
test('the owner Meta button goes to coexistence signup, never to Barka direct bind', () => {
  const calls = [];
  const inputs = {};
  function el(parent, id) { const e = { parentElement: parent, id, textContent: '', closest() { return this; } }; if (id) inputs[id] = e; return e; }
  const box = el(null);
  const cards = Object.fromEntries(['muscat', 'barka', 'investment', 'owner'].map(k => { const card = el(box); el(card, 'routePhone_' + k); return [k, card]; }));
  const ownerButton = el(cards.owner); ownerButton.textContent = 'ربط / تحديث عبر Meta';
  let captured = null;
  const ctx = {
    document: { readyState: 'complete', addEventListener(type, fn) { if (type === 'click') captured = fn; }, getElementById: id => inputs[id] || null },
    window: { addEventListener() {}, launchWhatsAppEmbeddedSignup: k => calls.push(['embedded', k]) },
    setTimeout() {}, isOwner: () => true,
    supa: { functions: { invoke: async (...a) => { calls.push(['invoke', ...a]); return { data: { ok: true } }; } } },
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx); vm.runInContext('var window=this.window;' + fs.readFileSync(path.join(ROOT, 'whatsapp-direct-bind-ui.js'), 'utf8'), ctx);
  let prevented = false;
  captured({ target: { closest: () => ownerButton }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, false);
  ctx.window.launchWhatsAppEmbeddedSignup('owner');
  assert.deepEqual(calls, [['embedded', 'owner']]);
});

// ---------- Coexistence: history import and sync requests ----------
test('owner bind requests contacts then history sync with the business token', async () => {
  const rows = baseRows(); Object.assign(rows.company_lead_routes.find(r => r.route_key === 'owner'), { meta_phone_number_id: null, is_active: false });
  const f = runtime('whatsapp-embedded-signup', { userId: OWNER, rows, fetchImpl: fakeMeta('+968 9094 4469') });
  const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', session_info: {} });
  assert.equal(r.status, 200);
  const syncs = f.fetches.filter(([u]) => String(u).includes('/TEST-phone/smb_app_data'));
  assert.deepEqual(syncs.map(([, init]) => JSON.parse(init.body).sync_type), ['smb_app_state_sync', 'history']);
  for (const [, init] of syncs) { assert.equal(JSON.parse(init.body).messaging_product, 'whatsapp'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer TEST-business-token'); }
  assert.equal(r.body.coexistence_sync.history.ok, true);
  assert.equal(rows.whatsapp_onboarding_events.at(-1).details.coexistence_sync.smb_app_state_sync.ok, true);
});
test('a failed sync request never undoes the owner bind', async () => {
  const rows = baseRows(); Object.assign(rows.company_lead_routes.find(r => r.route_key === 'owner'), { meta_phone_number_id: null, is_active: false });
  const f = runtime('whatsapp-embedded-signup', { userId: OWNER, rows, fetchImpl: fakeMeta('+968 9094 4469', { syncFails: true }) });
  const r = await f.invoke({ route_key: 'owner', code: 'TEST-only', session_info: {} });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.equal(r.body.coexistence_sync.history.ok, false); assert.match(r.body.coexistence_sync.history.error, /window expired/);
  const route = rows.company_lead_routes.find(x => x.route_key === 'owner');
  assert.equal(route.is_active, true); assert.equal(route.meta_phone_number_id, 'TEST-phone');
});
test('Muscat/Barka binds never request coexistence sync', async () => {
  const rows = baseRows(); rows.company_lead_routes.find(r => r.route_key === 'barka').whatsapp_number = '+96890000002';
  const f = runtime('whatsapp-embedded-signup', { userId: OWNER, rows, fetchImpl: fakeMeta('+968 9000 0002') });
  const r = await f.invoke({ route_key: 'barka', code: 'TEST-only', session_info: {} });
  assert.equal(r.status, 200); assert.equal(r.body.coexistence_sync, undefined);
  assert(!f.fetches.some(([u]) => String(u).includes('smb_app_data')));
});

function historyValue(pnid, messages, extra = {}) {
  return { messaging_product: 'whatsapp', metadata: { phone_number_id: pnid, display_phone_number: '96890944469' },
    history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: '96811110005', messages }], ...extra }] };
}
const histMessages = [
  { from: '96811110005', id: 'wamid.TEST-h1', timestamp: '1780000000', type: 'text', text: { body: 'TEST investor question' }, history_context: { status: 'READ' } },
  { from: '96890944469', to: '96811110005', id: 'wamid.TEST-h2', timestamp: '1780000060', type: 'text', text: { body: 'TEST owner answer' }, history_context: { status: 'DELIVERED' } },
  { from: '96811110005', id: 'wamid.TEST-h3', timestamp: '1780000120', type: 'media_placeholder' },
];
test('history import stores owner-line chats with original time and direction, no CRM identity', async () => {
  const f = runtime('whatsapp-webhook');
  await f.ctx.processEnvelopeOnce({ entry: [{ changes: [{ field: 'history', value: historyValue(OWNER_PNID, histMessages) }] }] }).then(errs => assert.deepEqual([...errs], []));
  const conv = f.rows.whatsapp_conversations.find(c => c.customer_wa_id === '96811110005');
  assert.equal(conv.route_key, 'owner'); assert.equal(conv.client_id, null); assert.equal(conv.assigned_to, OWNER);
  const msgs = f.rows.whatsapp_messages.filter(m => m.conversation_id === conv.id);
  assert.deepEqual(msgs.map(m => [m.whatsapp_message_id, m.direction, m.message_type]), [['wamid.TEST-h1', 'inbound', 'text'], ['wamid.TEST-h2', 'outbound', 'text'], ['wamid.TEST-h3', 'inbound', 'media_placeholder']]);
  assert(msgs.every(m => m.client_id === null && m.channel_source === 'owner_history_import'));
  assert.equal(msgs[0].message_timestamp, new Date(1780000000 * 1000).toISOString());
  assert.equal(msgs[0].delivery_status, 'read');
  assert(!f.calls.some(c => ['clients', 'client_requests', 'activities'].includes(c.table)));
  assert(!f.calls.some(c => c.rpc && c.rpc !== 'resolve_whatsapp_route')); assert.equal(f.fetches.length, 0);
  assert.equal(f.rows.whatsapp_onboarding_events.at(-1).status, 'completed');
});
test('history import is idempotent and upgrades a media placeholder in place', async () => {
  const f = runtime('whatsapp-webhook');
  const env = { entry: [{ changes: [{ field: 'history', value: historyValue(OWNER_PNID, histMessages) }] }] };
  await f.ctx.processEnvelopeOnce(env); await f.ctx.processEnvelopeOnce(env);
  assert.equal(f.rows.whatsapp_messages.filter(m => String(m.whatsapp_message_id).startsWith('wamid.TEST-h')).length, 3);
  assert.equal(f.rows.whatsapp_conversations.filter(c => c.customer_wa_id === '96811110005').length, 1);
  const media = [{ from: '96811110005', id: 'wamid.TEST-h3', timestamp: '1780000120', type: 'image', image: { id: '998877', mime_type: 'image/jpeg' } }];
  await f.ctx.processEnvelopeOnce({ entry: [{ changes: [{ field: 'history', value: historyValue(OWNER_PNID, media) }] }] });
  const row = f.rows.whatsapp_messages.find(m => m.whatsapp_message_id === 'wamid.TEST-h3');
  assert.equal(row.message_type, 'image'); assert.equal(row.media_id, '998877');
  assert.equal(f.rows.whatsapp_messages.filter(m => m.whatsapp_message_id === 'wamid.TEST-h3').length, 1);
});
test('declined history sharing is logged, not crashed', async () => {
  const f = runtime('whatsapp-webhook');
  const value = { metadata: { phone_number_id: OWNER_PNID }, history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business from the WhatsApp Business App' }] }] };
  const errs = await f.ctx.processEnvelopeOnce({ entry: [{ changes: [{ field: 'history', value }] }] });
  assert.deepEqual([...errs], []);
  const ev = f.rows.whatsapp_onboarding_events.at(-1);
  assert.equal(ev.route_key, 'owner'); assert.equal(ev.status, 'failed'); assert.equal(ev.details.declined, true);
  assert(!f.writes.some(w => w.table === 'whatsapp_messages'));
});
test('history on a branch line is ignored; contact sync is accepted without writes', async () => {
  const f = runtime('whatsapp-webhook');
  const errs = await f.ctx.processEnvelopeOnce({ entry: [{ changes: [
    { field: 'history', value: historyValue(MUSCAT_PNID, histMessages) },
    { field: 'smb_app_state_sync', value: { metadata: { phone_number_id: OWNER_PNID }, state_sync: [{ type: 'contact', action: 'add', contact: { phone_number: '96811110005' } }] } },
  ] }] });
  assert.deepEqual([...errs], []); assert.equal(f.writes.length, 0);
});
test('staff never see imported owner history in the inbox; the owner does', async () => {
  const f = runtime('whatsapp-webhook');
  await f.ctx.processEnvelopeOnce({ entry: [{ changes: [{ field: 'history', value: historyValue(OWNER_PNID, histMessages) }] }] });
  const rows = f.rows;
  const conv = rows.whatsapp_conversations.find(c => c.customer_wa_id === '96811110005');
  for (const userId of [MANAGER, AGENT]) {
    const inbox = runtime('whatsapp-inbox', { userId, rows });
    const list = await inbox.invoke({ action: 'list' });
    assert(!list.body.conversations.some(c => c.id === conv.id));
    const r = await inbox.invoke({ action: 'messages', conversation_id: conv.id });
    assert.equal(r.status, 404);
  }
  const owner = runtime('whatsapp-inbox', { userId: OWNER, rows });
  const r = await owner.invoke({ action: 'messages', conversation_id: conv.id });
  assert.equal(r.status, 200); assert.equal(r.body.messages.length, 3);
});
