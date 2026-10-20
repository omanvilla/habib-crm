'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const COMPANY = 'TEST-company', OWNER = 'TEST-owner', AGENT = 'TEST-agent';
const PHONE = '+96800000000', PHONE_ID = '12345', BARKA_PHONE_ID = '23456';
const OPERATION = '00000000-0000-4000-8000-000000000020';
const clone = value => structuredClone(value);
const privateRow = row => [row?.lead_route, row?.route_key, row?.branch_key].includes('investment');
async function syntheticCredential(routeKey, token = 'TEST-route-token') {
  const seed = new TextEncoder().encode(`TEST-value|${COMPANY}|${routeKey}|habib-crm-whatsapp-v1`);
  const digest = await webcrypto.subtle.digest('SHA-256', seed);
  const key = await webcrypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = new Uint8Array(12).fill(7);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { company_id: COMPANY, route_key: routeKey, token_ciphertext: Buffer.from(ciphertext).toString('base64'), token_iv: Buffer.from(iv).toString('base64'), expires_at: null, token_type: 'system_user' };
}

// Execute the actual Edge handlers/helpers with isolated rows. The SQL route
// resolver and RLS are modeled contracts here; native SQL tests verify them.
// Every HTTP response is generated in memory and no network can leave this VM.
function fixture(name, { role = 'owner', branch = 'muscat', privateClient = false, privateRequest = false,
  privateConversation = false, existingConversation = true, rpcFailure = false, collision = false,
  staleAssignment = false, active = true, oldWindow = false, classifyAtPersistence = false,
  classifyDuringExtraction = false } = {}) {
  const calls = [], writes = [], fetches = [], aiContexts = [], attributions = [], pending = [];
  const profile = { id: role === 'owner' ? OWNER : AGENT, company_id: COMPANY, role, is_active: active, phone: null };
  const physicalId = branch === 'barka' ? BARKA_PHONE_ID : PHONE_ID;
  const rows = {
    profiles: [profile],
    company_lead_routes: [
      { company_id: COMPANY, route_key: 'muscat', assigned_to: OWNER, is_active: true, meta_phone_number_id: PHONE_ID, whatsapp_number: '+96800000001', owner_only_inbox: false },
      { company_id: COMPANY, route_key: 'barka', assigned_to: AGENT, is_active: true, meta_phone_number_id: BARKA_PHONE_ID, whatsapp_number: '+96800000002', owner_only_inbox: false },
      { company_id: COMPANY, route_key: 'investment', assigned_to: OWNER, is_active: true, transport_route_key: 'muscat', meta_phone_number_id: null, whatsapp_number: null, owner_only_inbox: true },
    ],
    clients: [{ id: 'TEST-client', company_id: COMPANY, lead_route: privateClient ? 'investment' : branch, phone: PHONE, phone_normalized: '96800000000', assigned_to: profile.id, name: 'TEST-client-name', last_contact_at: '2026-01-01T00:00:00Z' }],
    client_requests: [{ id: 'TEST-request', company_id: COMPANY, client_id: 'TEST-client', route_key: privateRequest ? 'investment' : branch,
      branch_key: privateRequest ? 'investment' : branch, request_type: privateRequest ? 'investor' : 'buyer', assigned_to: privateRequest ? OWNER : profile.id, status: 'active', updated_at: '2026-01-01T00:00:00Z' }],
    client_request_assignees: [], whatsapp_message_requests: [], whatsapp_send_operations: [],
    whatsapp_route_credentials: [], activities: [], whatsapp_messages: [],
    whatsapp_conversations: existingConversation ? [{ id: 'TEST-conversation', company_id: COMPANY, client_id: 'TEST-client', customer_wa_id: '96800000000', customer_phone: PHONE,
      route_key: privateConversation ? 'investment' : branch, assigned_to: privateConversation ? OWNER : profile.id, meta_phone_number_id: physicalId,
      last_inbound_at: oldWindow ? '2020-01-01T00:00:00Z' : new Date().toISOString(), unread_count: 0 }] : [],
  };
  function classifyThread() {
    rows.client_requests.push({ id: 'TEST-new-private-request', company_id: COMPANY, client_id: 'TEST-client',
      route_key: 'investment', branch_key: 'investment', request_type: 'investor', assigned_to: OWNER, status: 'active' });
    Object.assign(rows.whatsapp_conversations[0], { route_key: 'investment', assigned_to: OWNER });
  }
  let collisionRemaining = collision;
  const split = expression => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++; if (expression[i] === ')') depth--;
      if (expression[i] === ',' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
    }
    parts.push(expression.slice(start)); return parts;
  };
  const matchesExpression = (row, expression) => {
    if (expression.startsWith('and(')) return split(expression.slice(4, -1)).every(part => matchesExpression(row, part));
    if (expression.startsWith('or(')) return split(expression.slice(3, -1)).some(part => matchesExpression(row, part));
    const [key, op, ...rest] = expression.split('.'), value = rest.join('.');
    if (op === 'is') return row[key] == null;
    if (op === 'eq') return row[key] === value;
    if (op === 'neq') return row[key] != null && row[key] !== value;
    throw new Error('Unhandled expression: ' + expression);
  };
  function callerCanRead(table, row) {
    if (!active) return false;
    if (role === 'owner') return true;
    if (privateRow(row)) return false;
    if (table === 'whatsapp_conversations' && role === 'agent') return !staleAssignment && row.route_key === branch;
    if (table === 'whatsapp_messages') return callerCanRead('whatsapp_conversations', rows.whatsapp_conversations.find(item => item.id === row.conversation_id));
    return true;
  }
  function makeDb(userScope = false) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
      async rpc(fn, args) {
        calls.push({ rpc: fn, args: clone(args) });
        if (fn === 'resolve_whatsapp_route') return { data: rows.company_lead_routes.filter(row => row.meta_phone_number_id === args.p_meta_phone_number_id && row.is_active), error: null };
        if (fn === 'crm_resolve_whatsapp_business_route') {
          if (rpcFailure) return { data: null, error: { message: 'TEST route unavailable' } };
          const previous = rows.whatsapp_conversations.find(row => row.id === args.p_existing_conversation_id);
          const canonical = privateRow(rows.clients[0]) || privateRow(previous)
            || (args.p_physical_route_key === 'muscat' && rows.client_requests.some(privateRow));
          return { data: { route_key: canonical ? 'investment' : args.p_physical_route_key, transport_route_key: args.p_physical_route_key,
            assigned_to: canonical ? OWNER : rows.company_lead_routes.find(row => row.route_key === args.p_physical_route_key).assigned_to, owner_only_inbox: canonical }, error: null };
        }
        if (fn === 'upsert_whatsapp_client_identity') return { data: { client_id: rows.clients[0].id, assigned_to: args.p_assigned_to, created: false }, error: null };
        if (fn === 'apply_whatsapp_request_batch_guarded') return { data: { applied_count: 0, already_processed: false, needs_human_review: false }, error: null };
        throw new Error('Unhandled RPC: ' + fn);
      },
      from(table) {
        assert(Object.hasOwn(rows, table), 'Unexpected table: ' + table);
        const call = { table, scope: userScope ? 'user' : 'admin', operation: 'select', filters: [] }, predicates = [];
        let single = false, limit = Infinity, patch;
        const q = {
          select(columns) { call.columns = columns; return q; },
          eq(key, value) { call.filters.push(['eq', key, value]); predicates.push(row => row[key] === value); return q; },
          in(key, values) { predicates.push(row => values.includes(row[key])); return q; },
          or(expression) { predicates.push(row => split(expression).some(part => matchesExpression(row, part))); return q; },
          not(key, op, value) { if (op === 'is') predicates.push(row => row[key] != null); else if (op === 'in') { const values = value.slice(1, -1).split(','); predicates.push(row => !values.includes(row[key])); } else throw new Error('Unexpected not'); return q; },
          order() { return q; }, limit(value) { limit = value; return q; },
          single() { single = true; return q; }, maybeSingle() { single = true; return q; },
          update(value) { call.operation = 'update'; patch = clone(value); return q; },
          insert(value) { call.operation = 'insert'; patch = clone(value); return q; },
          then(resolve, reject) { return Promise.resolve().then(() => {
            calls.push({ ...call, patch });
            let selected = rows[table].filter(row => predicates.every(predicate => predicate(row)) && (!userScope || callerCanRead(table, row))).slice(0, limit);
            if (call.operation === 'insert') {
              if (table === 'whatsapp_conversations' && collisionRemaining) {
                collisionRemaining = false;
                rows.whatsapp_conversations.push({ ...patch, id: 'TEST-racing-conversation', route_key: 'investment', assigned_to: OWNER });
                return { data: null, error: { code: '23505', message: 'TEST concurrent conversation' } };
              }
              const key = table === 'whatsapp_messages' ? 'whatsapp_message_id' : table === 'whatsapp_send_operations' ? 'operation_key' : table === 'activities' ? 'id' : null;
              if (key && rows[table].some(row => row[key] === patch[key])) return { data: null, error: { code: '23505', message: 'TEST duplicate' } };
              const row = { id: 'TEST-' + table + '-' + rows[table].length, ...patch };
              rows[table].push(row); selected = [row]; writes.push({ ...call, patch });
              if (table === 'whatsapp_messages' && classifyAtPersistence) classifyThread();
            }
            if (call.operation === 'update') { selected.forEach(row => Object.assign(row, patch)); writes.push({ ...call, patch }); }
            return { data: clone(single ? selected[0] || null : selected), error: null };
          }).then(resolve, reject); },
        };
        return q;
      },
    };
  }
  const admin = makeDb(), user = makeDb(true);
  const ctx = {
    Deno: { env: { get: key => key === 'CRM_COMPANY_ID' ? COMPANY : key === 'SUPABASE_ANON_KEY' ? 'TEST-anon' : 'TEST-value' }, serve: handler => { ctx.handler = handler; } },
    createClient: (_url, key) => key === 'TEST-anon' ? user : admin,
    createPropertyInquiryService: () => ({ attributeOutbound: async id => { attributions.push(id); return {}; }, queueReview: async () => {} }),
    EdgeRuntime: { waitUntil: promise => pending.push(promise) },
    Response, Request, Headers, Blob, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal,
    crypto: webcrypto, btoa, atob, console: { error() {}, log() {}, warn() {} },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      assert.equal(name, 'whatsapp-send', 'Unexpected provider call');
      assert.equal(url, `https://graph.facebook.com/TEST-value/${physicalId}/messages`);
      assert(['Bearer TEST-value', 'Bearer TEST-route-token'].includes(options.headers.Authorization));
      assert.equal(JSON.parse(options.body).to, '96800000000');
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST-only' }] }), { status: 200 });
    },
  };
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions', name, 'index.ts'), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import\s[^\n]+;\s*$/mg, '')), ctx, { filename: name + '.ts' });
  if (name === 'whatsapp-webhook') {
    ctx.extractRequestsWithOpenAI = async (_body, _name, requests, logicalRoute) => {
      aiContexts.push({ requests: clone(requests), logicalRoute });
      if (classifyDuringExtraction && aiContexts.length === 1) {
        classifyThread();
        return { requests: [{ action: 'update', existing_request_id: 'TEST-request', fields_present: ['budget'], budget_min: 999 }], needs_human_review: false };
      }
      return { requests: [], needs_human_review: false };
    };
    ctx.attributeSpecificListingText = async args => { attributions.push(clone(args)); return { property_ids: [] }; };
    ctx.finalizePropertyAttribution = async () => {};
    ctx.alertUnresolvedListingReference = async () => {};
    ctx.isAllowedTestCustomer = async () => false;
  }
  async function invoke(body) {
    const result = await ctx.handler(new Request('https://test.invalid/edge', { method: 'POST', headers: { authorization: 'Bearer TEST-session', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: result.status, body: await result.json() };
  }
  return { ctx, rows, calls, writes, fetches, aiContexts, attributions, pending, invoke, physicalId };
}
const inbound = { from: '96800000000', id: 'wamid.TEST-inbound', type: 'text', text: { body: 'TEST property inquiry' }, timestamp: '1792444800' };
const envelope = phoneId => ({ metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: '96800000000', profile: { name: 'TEST-contact' } }] });
const send = { client_id: 'TEST-client', request_id: 'TEST-request', body: 'TEST private response', operation_id: OPERATION };

test('classification during message persistence changes all later extraction and batch context to private', async () => {
  const f = fixture('whatsapp-webhook', { classifyAtPersistence: true });
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  assert.deepEqual(f.aiContexts.map(row => row.logicalRoute), ['investment']);
  assert(f.aiContexts[0].requests.every(privateRow));
  assert(f.calls.filter(call => call.rpc === 'apply_whatsapp_request_batch_guarded').every(call => call.args.p_route_key === 'investment'));
  assert.equal(f.rows.activities[0].after_data.route_key, 'investment');
  assert.equal(f.rows.whatsapp_messages[0].ai_extracted.crm_route_key, 'investment');
  assert.equal(f.fetches.length, 0);
});

test('classification while AI is running discards ordinary inference before applying a private batch', async () => {
  const f = fixture('whatsapp-webhook', { classifyDuringExtraction: true });
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  assert.deepEqual(f.aiContexts.map(row => row.logicalRoute), ['muscat', 'investment']);
  assert(f.aiContexts[1].requests.every(privateRow));
  const batches = f.calls.filter(call => call.rpc === 'apply_whatsapp_request_batch_guarded');
  assert.equal(batches.length, 1); assert.equal(batches[0].args.p_route_key, 'investment');
  assert.deepEqual(batches[0].args.p_requests, []);
  assert.equal(f.rows.client_requests[0].budget_min, undefined);
  assert.equal(f.rows.activities[0].after_data.route_key, 'investment');
  assert.equal(f.fetches.length, 0);
});

for (const cacheRoute of ['muscat', undefined]) test(`private retry discards cached extraction from ${cacheRoute || 'an unrecorded route'}`, async () => {
  const f = fixture('whatsapp-webhook', { privateRequest: true });
  f.rows.whatsapp_messages.push({ id: 'TEST-cached-message', company_id: COMPANY, conversation_id: 'TEST-conversation', client_id: 'TEST-client',
    whatsapp_message_id: inbound.id, ai_processed_at: null, processing_error: 'TEST retry',
    ai_extracted: { crm_route_key: cacheRoute, requests: [{ action: 'update', existing_request_id: 'TEST-request', budget_min: 999 }] } });
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  assert.equal(f.aiContexts.length, 1); assert.equal(f.aiContexts[0].logicalRoute, 'investment');
  assert.equal(f.rows.whatsapp_messages[0].ai_extracted.crm_route_key, 'investment');
  assert.deepEqual(f.calls.find(call => call.rpc === 'apply_whatsapp_request_batch_guarded').args.p_requests, []);
  assert.equal(f.fetches.length, 0);
});

test('owner cannot send an ordinary request through a newly private thread before claiming or sending', async () => {
  const f = fixture('whatsapp-send', { privateConversation: true });
  const result = await f.invoke(send);
  assert.equal(result.status, 409); assert.equal(result.body.error, 'request_conversation_scope_changed');
  assert.equal(f.rows.whatsapp_send_operations.length, 0); assert.equal(f.fetches.length, 0);
  assert(!f.calls.some(call => call.table === 'whatsapp_route_credentials'));
});

test('owner can reply to a private Muscat thread without inventing a request association', async () => {
  const f = fixture('whatsapp-send', { privateConversation: true });
  f.rows.client_requests = [];
  const result = await f.invoke({ ...send, request_id: undefined, conversation_id: 'TEST-conversation' });
  await Promise.all(f.pending);
  assert.equal(result.status, 200); assert.equal(result.body.sent, true); assert.equal(result.body.request_id, null);
  assert.equal(f.fetches.length, 1); assert.equal(f.rows.whatsapp_messages[0].request_id, null);
});

for (const condition of ['privateClient', 'privateRequest', 'privateConversation']) test(`Muscat inbound with ${condition} remains private before insertion and on webhook replay`, async () => {
  const f = fixture('whatsapp-webhook', { [condition]: true });
  const parent = clone(f.rows.clients[0]);
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'investment');
  assert.equal(f.rows.whatsapp_conversations[0].meta_phone_number_id, PHONE_ID);
  assert.equal(f.rows.whatsapp_conversations[0].assigned_to, OWNER);
  assert.equal(f.rows.whatsapp_messages.length, 1); assert.equal(f.rows.activities.length, 1);
  assert.equal(f.rows.activities[0].after_data.route_key, 'investment');
  assert.equal(f.aiContexts[0].logicalRoute, 'investment');
  assert(f.aiContexts[0].requests.every(privateRow));
  assert.deepEqual(f.rows.clients[0], parent);
  const messageInsert = f.calls.findIndex(call => call.table === 'whatsapp_messages' && call.operation === 'insert');
  const privacyResolve = f.calls.findIndex(call => call.rpc === 'crm_resolve_whatsapp_business_route');
  assert(privacyResolve >= 0 && privacyResolve < messageInsert);
  assert.equal(f.fetches.length, 0);
});

for (const branch of ['muscat', 'barka']) test(`ordinary ${branch} inquiry uses its physical line and ordinary request context`, async () => {
  const f = fixture('whatsapp-webhook', { branch });
  f.rows.clients[0].is_investor = true; // Legacy flags alone never make a private business route.
  await f.ctx.processInboundMessage(envelope(f.physicalId), inbound);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, branch);
  assert.equal(f.rows.whatsapp_conversations[0].meta_phone_number_id, f.physicalId);
  assert.equal(f.aiContexts[0].logicalRoute, branch);
  assert(f.aiContexts[0].requests.every(row => !privateRow(row)));
  assert.equal(f.rows.whatsapp_messages.length, 1); assert.equal(f.fetches.length, 0);
});

test('canonical private contact remains private on Barka without pretending its physical number is Muscat', async () => {
  const f = fixture('whatsapp-webhook', { branch: 'barka', privateClient: true });
  await f.ctx.processInboundMessage(envelope(BARKA_PHONE_ID), inbound);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'investment');
  assert.equal(f.rows.whatsapp_conversations[0].meta_phone_number_id, BARKA_PHONE_ID);
  assert.equal(f.aiContexts[0].logicalRoute, 'investment'); assert.equal(f.fetches.length, 0);
});

test('an ordinary Barka thread is not reassigned from an unrelated private request on its shared contact', async () => {
  const f = fixture('whatsapp-webhook', { branch: 'barka', privateRequest: true });
  await f.ctx.processInboundMessage(envelope(BARKA_PHONE_ID), inbound);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'barka');
  assert.equal(f.aiContexts[0].logicalRoute, 'barka');
  assert.equal(f.aiContexts[0].requests.length, 0); assert.equal(f.fetches.length, 0);
});

test('unavailable business routing stops before any conversation, client or message write', async () => {
  const f = fixture('whatsapp-webhook', { rpcFailure: true });
  await assert.rejects(f.ctx.processInboundMessage(envelope(PHONE_ID), inbound), /business route/);
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});

test('concurrent first conversation insertion reloads the private winner without duplication or downgrade', async () => {
  const f = fixture('whatsapp-webhook', { existingConversation: false, collision: true });
  await f.ctx.processInboundMessage(envelope(PHONE_ID), inbound);
  assert.equal(f.rows.whatsapp_conversations.length, 1);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'investment');
  assert.equal(f.rows.whatsapp_messages.length, 1);
  assert.equal(f.aiContexts[0].logicalRoute, 'investment');
  assert.equal(f.fetches.length, 0);
});

test('business-app echo on shared Muscat keeps private logical route and physical sender', async () => {
  const f = fixture('whatsapp-webhook', { privateConversation: true });
  const echo = { to: '96800000000', id: 'wamid.TEST-echo', type: 'text', text: { body: 'TEST owner response' }, timestamp: '1792444800' };
  await f.ctx.processOutboundEcho(envelope(PHONE_ID), echo);
  await f.ctx.processOutboundEcho(envelope(PHONE_ID), echo);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'investment');
  assert.equal(f.rows.whatsapp_messages.length, 1);
  assert.equal(f.rows.whatsapp_messages[0].sender_wa_id, PHONE_ID);
  assert.equal(f.rows.whatsapp_messages[0].actor_type, 'human');
  assert.equal(f.fetches.length, 0);
});

test('a resumed inbound activity save uses the original message key and rejects an unrelated ID collision', async () => {
  const f = fixture('whatsapp-webhook', { privateRequest: true });
  const evidence = { conversationId: 'TEST-conversation', messageId: 'TEST-inbound-key', routeKey: 'investment', messageAt: '2026-10-19T20:00:00Z' };
  await f.ctx.logInboundActivity('TEST-client', OWNER, 'TEST-private', 'text', 0, false, evidence);
  await f.ctx.logInboundActivity('TEST-client', OWNER, 'TEST-private', 'text', 0, false, evidence);
  assert.equal(f.rows.activities.length, 1); assert.equal(f.rows.activities[0].id, evidence.messageId);
  f.rows.activities[0].after_data.conversation_id = 'TEST-unrelated';
  await assert.rejects(f.ctx.logInboundActivity('TEST-client', OWNER, 'TEST-private', 'text', 0, false, evidence), /inbound_activity_identity_conflict/);
  assert.equal(f.rows.activities.length, 1); assert.equal(f.fetches.length, 0);
});

test('owner sends a private request through Muscat once, keeps its private journal, and preserves ordinary parent summary', async () => {
  const f = fixture('whatsapp-send', { privateRequest: true });
  f.rows.whatsapp_route_credentials.push(await syntheticCredential('muscat'));
  const parent = clone(f.rows.clients[0]);
  const result = await f.invoke(send);
  await Promise.all(f.pending);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.sent, true);
  assert.equal(result.body.route_key, 'investment'); assert.equal(result.body.transport_route_key, 'muscat');
  assert.equal(result.body.sender_phone_number_id, PHONE_ID);
  assert.equal(f.rows.whatsapp_conversations[0].route_key, 'investment');
  assert.equal(f.rows.whatsapp_messages[0].request_id, 'TEST-request');
  assert.equal(f.rows.whatsapp_messages[0].raw_payload.route_key, 'investment');
  assert.equal(f.rows.whatsapp_messages[0].raw_payload.transport_route_key, 'muscat');
  assert.equal(f.rows.activities[0].after_data.conversation_id, f.rows.whatsapp_conversations[0].id);
  assert.deepEqual(f.rows.clients[0], parent);
  const credential = f.calls.find(call => call.table === 'whatsapp_route_credentials');
  assert(credential.filters.some(item => item[1] === 'route_key' && item[2] === 'muscat'));
  assert.equal(f.fetches[0].options.headers.Authorization, 'Bearer TEST-route-token');
  const replay = await f.invoke(send);
  assert.equal(replay.body.replayed, true);
  assert.equal(f.fetches.length, 1); assert.equal(f.rows.whatsapp_messages.length, 1); assert.equal(f.rows.activities.length, 1);
});

for (const branch of ['muscat', 'barka']) test(`ordinary ${branch} send retains its physical number and business record`, async () => {
  const f = fixture('whatsapp-send', { branch });
  const result = await f.invoke(send); await Promise.all(f.pending);
  assert.equal(result.body.sent, true, JSON.stringify(result.body));
  assert.equal(result.body.route_key, branch); assert.equal(result.body.transport_route_key, branch);
  assert.equal(result.body.sender_phone_number_id, f.physicalId); assert.equal(f.fetches.length, 1);
});

for (const role of ['agent', 'manager']) test(`${role} cannot send into investment through the shared physical Muscat line`, async () => {
  const f = fixture('whatsapp-send', { role, privateRequest: true });
  const result = await f.invoke(send);
  assert.equal(result.status, 404); assert.equal(result.body.error, 'request_not_found');
  assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
  assert(!f.calls.some(call => call.table === 'whatsapp_route_credentials'));
});

test('stale assignment cannot authorize a direct send denied by current conversation RLS', async () => {
  const f = fixture('whatsapp-send', { role: 'agent', staleAssignment: true });
  const result = await f.invoke(send);
  assert.equal(result.status, 403); assert.equal(result.body.error, 'conversation_not_authorized');
  assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
  assert(!f.calls.some(call => call.table === 'whatsapp_route_credentials' || call.rpc));
});

test('investment waits for a real Muscat inbound instead of sending from a Barka thread', async () => {
  const f = fixture('whatsapp-send', { privateRequest: true, branch: 'barka' });
  const result = await f.invoke({ ...send, conversation_id: 'TEST-conversation' });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'route_handoff_required');
  assert.match(result.body.message, /رقم مسقط/);
  assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
});

test('expired investment window and disabled account stop before privacy mutation or sending', async () => {
  for (const options of [{ privateRequest: true, oldWindow: true }, { privateRequest: true, active: false }]) {
    const f = fixture('whatsapp-send', options), result = await f.invoke(send);
    assert([403, 409].includes(result.status)); assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
  }
});

test('owner image preview for private Muscat conversation uses physical Muscat credentials', async () => {
  const f = fixture('whatsapp-inbox', { privateConversation: true });
  f.rows.whatsapp_route_credentials.push(await syntheticCredential('muscat'));
  f.rows.whatsapp_messages.push({ id: 'TEST-image', company_id: COMPANY, conversation_id: 'TEST-conversation', direction: 'inbound', message_type: 'image', media_id: '123456' });
  f.ctx.fetchImagePreview = async (mediaId, tokens) => {
    assert.equal(mediaId, '123456'); assert.equal(tokens[0], 'TEST-route-token'); assert(tokens.includes('TEST-value'));
    return { mime_type: 'image/png', data_url: 'data:image/png;base64,VEVTVA==' };
  };
  const result = await f.invoke({ action: 'media', conversation_id: 'TEST-conversation', message_id: 'TEST-image' });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.ok, true);
  const credential = f.calls.find(call => call.table === 'whatsapp_route_credentials');
  assert(credential.filters.some(item => item[1] === 'route_key' && item[2] === 'muscat'));
  assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
});

test('staff cannot retrieve a private image through the Muscat physical line', async () => {
  const f = fixture('whatsapp-inbox', { privateConversation: true, role: 'agent' });
  const result = await f.invoke({ action: 'media', conversation_id: 'TEST-conversation', message_id: 'TEST-image' });
  assert.equal(result.status, 404);
  assert(!f.calls.some(call => call.table === 'whatsapp_route_credentials' || call.rpc));
  assert.equal(f.fetches.length, 0); assert.equal(f.writes.length, 0);
});

test('legacy investor connection actions show shared Muscat reception without invoking Meta', async () => {
  const callbacks = [], toasts = []; let metaCalls = 0, legacyCalls = 0;
  const ctx = { document: { readyState: 'loading', addEventListener: (_event, fn) => callbacks.push(fn) },
    setTimeout() {}, showToast: text => toasts.push(text), FB: { login: () => metaCalls++ },
    launchWhatsAppEmbeddedSignup: () => legacyCalls++, addEventListener() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../whatsapp-direct-bind-ui.js'), 'utf8'), ctx);
  callbacks[0]();
  await ctx.HabibDirectMetaBind('investment');
  ctx.launchWhatsAppEmbeddedSignup('investment');
  assert.equal(metaCalls, 0); assert.equal(legacyCalls, 0);
  assert.equal(toasts.length, 2); assert(toasts.every(text => text.includes('رقم مسقط')));
});
