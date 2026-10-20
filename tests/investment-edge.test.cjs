'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const COMPANY = 'TEST-company', OWNER = 'TEST-owner', AGENT = 'TEST-agent';
const source = name => fs.readFileSync(path.join(__dirname, '..', 'supabase/functions', name, 'index.ts'), 'utf8');
const privateRow = row => [row.route_key, row.branch_key].includes('investment');

// Execute the actual handlers, with every external fetch denied. These are
// synthetic authorization/routing tests, never customer sends or live tokens.
function runtime(name, { role = 'agent', active = true, clientRoute = 'muscat', requestRoute = null, conversationRoute = null, extraRequests = [], ownerAssignment = OWNER } = {}) {
  const calls = [], writes = [], fetches = [];
  const profile = { id: role === 'owner' ? OWNER : AGENT, company_id: COMPANY, role, is_active: active };
  const rows = {
    profiles: [profile],
    clients: [{ id: 'TEST-client', company_id: COMPANY, lead_route: clientRoute, assigned_to: clientRoute === 'investment' ? OWNER : AGENT, phone: '+96800000000' }],
    client_requests: requestRoute ? [{ id: 'TEST-request', company_id: COMPANY, client_id: 'TEST-client', branch_key: requestRoute, route_key: requestRoute, request_type: requestRoute === 'investment' ? 'investor' : 'buyer', assigned_to: requestRoute === 'investment' ? OWNER : AGENT, status: 'active', updated_at: '2026-01-01' }, ...extraRequests] : extraRequests,
    client_request_assignees: [],
    whatsapp_conversations: conversationRoute ? [{ id: 'TEST-conversation', company_id: COMPANY, client_id: 'TEST-client', route_key: conversationRoute, assigned_to: conversationRoute === 'investment' ? OWNER : AGENT, meta_phone_number_id: conversationRoute === 'barka' ? '23456' : '12345', last_inbound_at: '2020-01-01T00:00:00Z' }] : [],
    company_lead_routes: name === 'whatsapp-webhook' || name === 'whatsapp-send' ? [
      { route_key: 'muscat', company_id: COMPANY, assigned_to: AGENT, is_active: true, meta_phone_number_id: '12345', whatsapp_number: '+96800000001', owner_only_inbox: false },
      { route_key: 'barka', company_id: COMPANY, assigned_to: AGENT, is_active: true, meta_phone_number_id: '23456', whatsapp_number: '+96800000002', owner_only_inbox: false },
      { route_key: 'investment', company_id: COMPANY, assigned_to: ownerAssignment, is_active: true, meta_phone_number_id: null, whatsapp_number: null, transport_route_key: 'muscat', owner_only_inbox: true },
    ] : [],
    whatsapp_message_requests: [{ company_id: COMPANY, message_id: 'TEST-message', request_id: 'TEST-request' }],
  };
  const splitClauses = expression => {
    const clauses = []; let depth = 0, start = 0;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++;
      if (expression[i] === ')') depth--;
      if (expression[i] === ',' && depth === 0) { clauses.push(expression.slice(start, i)); start = i + 1; }
    }
    clauses.push(expression.slice(start)); return clauses;
  };
  const clauseMatches = (row, clause) => {
    if (clause.startsWith('and(')) return splitClauses(clause.slice(4, -1)).every(part => clauseMatches(row, part));
    if (clause.startsWith('or(')) return splitClauses(clause.slice(3, -1)).some(part => clauseMatches(row, part));
    const [key, op, ...parts] = clause.split('.'), value = parts.join('.');
    if (op === 'is') return row[key] == null;
    if (op === 'eq') return row[key] === value;
    if (op === 'neq') return row[key] != null && row[key] !== value;
    throw new Error('Unmodeled OR clause: ' + clause);
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    rpc: async (fn, args) => {
      calls.push({ rpc: fn, args });
      if (fn === 'resolve_whatsapp_route') return { data: rows.company_lead_routes.filter(row => row.meta_phone_number_id === args.p_meta_phone_number_id && row.is_active), error: null };
      if (fn === 'crm_resolve_whatsapp_business_route') {
        const conversation = rows.whatsapp_conversations.find(row => row.id === args.p_existing_conversation_id);
        const isPrivate = clientRoute === 'investment' || conversation?.route_key === 'investment' || (args.p_physical_route_key === 'muscat' && requestRoute === 'investment');
        return { data: { route_key: isPrivate ? 'investment' : args.p_physical_route_key, transport_route_key: args.p_physical_route_key, assigned_to: isPrivate ? ownerAssignment : AGENT, owner_only_inbox: isPrivate }, error: null };
      }
      if (fn === 'my_role') return { data: active === true ? role : null, error: null };
      if (fn === 'crm_shared_ai_evidence_mask') {
        assert.equal(role, 'owner'); assert(args.p_rows.length <= 1000);
        const privateIds = new Set(['TEST-private-evidence', 'TEST-private-request', 'TEST-unlinked-private-message', 'TEST-private-property', 'TEST-private-owner-property', 'TEST-private-property-view', 'TEST-private-source-only', 'TEST-private-appointment-only', 'TEST-private-viewing-only']);
        return { data: args.p_rows.map(ref => (rows[ref.table] || []).some(row => row.id === ref.id) && !privateIds.has(ref.id)), error: null };
      }
      throw new Error('Unexpected RPC: ' + fn);
    },
    from(table) {
      if (!Object.hasOwn(rows, table)) throw new Error('Forbidden unexpected table access: ' + table);
      const call = { table, operation: 'select', filters: [] };
      const predicates = [];
      const q = {
        select(columns) { call.columns = columns; return q; },
        eq(key, value) { call.filters.push(['eq', key, value]); predicates.push(row => row[key] === value); return q; },
        neq(key, value) { predicates.push(row => row[key] !== value); return q; },
        in(key, value) { call.filters.push(['in', key, value]); predicates.push(row => value.includes(row[key])); return q; },
        not(key, operator, value) { call.filters.push(['not', key, operator, value]); assert.equal(operator, 'is'); assert.equal(value, null); predicates.push(row => row[key] != null); return q; },
        or(expression) { call.filters.push(['or', expression]); predicates.push(row => splitClauses(expression).some(clause => clauseMatches(row, clause))); return q; },
        order() { return q; },
        limit(n) { call.limit = n; return q; },
        single() { call.single = true; return q; },
        maybeSingle() { call.single = true; return q; },
        update(patch) { call.operation = 'update'; call.patch = structuredClone(patch); return q; },
        insert(patch) { call.operation = 'insert'; call.patch = structuredClone(patch); return q; },
        then(resolve, reject) {
          calls.push(call);
          let matches = rows[table].filter(row => predicates.every(predicate => predicate(row)));
          if (call.limit) matches = matches.slice(0, call.limit);
          if (call.operation === 'update') { writes.push(call); matches.forEach(row => Object.assign(row, call.patch)); }
          if (call.operation === 'insert') { writes.push(call); const row = { id: 'TEST-new', ...call.patch }; rows[table].push(row); matches = [row]; }
          const data = call.single ? matches[0] || null : matches;
          return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const ctx = {
    Deno: { env: { get: name => name === 'CRM_COMPANY_ID' ? COMPANY : 'TEST-not-a-credential' }, serve: handler => { ctx.handler = handler; } },
    createClient: () => db, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto: webcrypto, btoa, atob, console: { error() {}, log() {}, warn() {} },
    fetch: async (...args) => { fetches.push(args); throw new Error('External network is forbidden in tests'); },
  };
  vm.createContext(ctx);
  const code = source(name).replace(/^import\s[^\n]+;\s*$/mg, '');
  vm.runInContext(stripTypeScriptTypes(code), ctx, { filename: name + '.ts' });
  async function invoke(body = {}) {
    const result = await ctx.handler(new Request('https://test.invalid/function', { method: 'POST', headers: { authorization: 'Bearer TEST-only', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: result.status, body: await result.json() };
  }
  return { ctx, db, rows, calls, writes, fetches, invoke };
}
const sendBody = { client_id: 'TEST-client', body: 'TEST synthetic content', operation_id: '00000000-0000-4000-8000-000000000001' };

for (const role of ['agent', 'manager', 'viewer']) {
  test(`whatsapp-send denies ${role} investment client before request/routing/credentials`, async () => {
    const f = runtime('whatsapp-send', { role, clientRoute: 'investment', conversationRoute: 'muscat' });
    const r = await f.invoke(sendBody);
    assert([403, 404].includes(r.status));
    assert(f.calls.every(call => ['profiles', 'clients'].includes(call.table)));
    assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
  });
}
for (const role of ['agent', 'manager']) {
  test(`whatsapp-send hides private request under existing public contact from ${role}`, async () => {
    const f = runtime('whatsapp-send', { role, requestRoute: 'investment', conversationRoute: 'muscat' });
    const r = await f.invoke({ ...sendBody, request_id: 'TEST-request' });
    assert.equal(r.status, 404); assert.equal(r.body.error, 'request_not_found');
    assert(!f.calls.some(call => call.table === 'whatsapp_conversations' || call.rpc));
    assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
  });
  test(`whatsapp-send denies ${role} direct investment conversation even with public parent`, async () => {
    const f = runtime('whatsapp-send', { role, conversationRoute: 'investment' });
    const r = await f.invoke({ ...sendBody, conversation_id: 'TEST-conversation' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'conversation_not_authorized');
    assert(!f.calls.some(call => call.rpc)); assert.equal(f.fetches.length, 0);
  });
}
test('private requests do not enter staff auto-selection or ambiguity counts', async () => {
  const f = runtime('whatsapp-send', { role: 'manager', requestRoute: 'investment', conversationRoute: 'muscat' });
  const r = await f.invoke(sendBody);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'conversation_not_authorized');
  const call = f.calls.find(call => call.table === 'client_requests');
  assert.deepEqual(call.filters.filter(filter => filter[0] === 'or'), [['or', 'and(or(route_key.is.null,route_key.neq.investment),or(branch_key.is.null,branch_key.neq.investment))']]);
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});
test('later private conversation cannot block staff fallback to an ordinary conversation', async () => {
  const f = runtime('whatsapp-send', { role: 'manager', conversationRoute: 'muscat' });
  f.rows.whatsapp_conversations.unshift({ ...f.rows.whatsapp_conversations[0], id: 'TEST-private', route_key: 'investment' });
  const r = await f.invoke(sendBody);
  assert.equal(r.status, 409); assert.equal(r.body.error, 'outside_customer_service_window');
  assert(f.calls.find(call => call.table === 'whatsapp_conversations').filters.some(filter => filter[0] === 'or' && filter[1] === 'route_key.is.null,route_key.neq.investment'));
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});
test('active owner passes investment permission gate; sending window remains enforced', async () => {
  const f = runtime('whatsapp-send', { role: 'owner', clientRoute: 'investment', requestRoute: 'investment', conversationRoute: 'investment' });
  const r = await f.invoke({ ...sendBody, request_id: 'TEST-request' });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'outside_customer_service_window');
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});
test('owner label with non-active profile cannot access investment', async () => {
  const f = runtime('whatsapp-send', { role: 'owner', active: null, clientRoute: 'investment' });
  const r = await f.invoke(sendBody); assert.equal(r.status, 404); assert.equal(f.fetches.length, 0);
});
for (const branch of ['muscat', 'barka']) {
  for (const role of ['agent', 'manager', 'owner']) {
    test(`ordinary ${branch} ${role} send permission/window behavior is retained`, async () => {
      const f = runtime('whatsapp-send', { role, clientRoute: branch, requestRoute: branch, conversationRoute: branch });
      if (role === 'owner') f.rows.client_requests[0].assigned_to = OWNER;
      const r = await f.invoke({ ...sendBody, request_id: 'TEST-request' });
      assert.equal(r.status, 409); assert.equal(r.body.error, 'outside_customer_service_window');
      assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
    });
  }
}
for (const name of ['whatsapp-direct-bind', 'whatsapp-embedded-signup']) {
  test(`${name} investment manager is rejected before route/credential/Meta access`, async () => {
    const f = runtime(name, { role: 'manager' });
    const r = await f.invoke({ route_key: 'investment', code: 'TEST-only' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'owner_required');
    assert(f.calls.every(call => call.table === 'profiles')); assert.equal(f.fetches.length, 0);
  });
  test(`${name} rejects retired investment onboarding before route, credential or Meta access`, async () => {
    const f = runtime(name, { role: 'owner' });
    const r = await f.invoke({ route_key: 'investment', code: 'TEST-only' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'investment_uses_muscat');
    assert.equal(r.body.transport_route_key, 'muscat');
    assert(f.calls.every(call => call.table === 'profiles'));
    assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
  });
  test(`${name} existing branch manager retains route-lookup access`, async () => {
    for (const [role, route] of [['owner', 'muscat'], ['manager', 'muscat'], ['manager', 'barka']]) {
      const f = runtime(name, { role }); const r = await f.invoke({ route_key: route, code: 'TEST-only' });
      assert.equal(r.status, 404); assert.equal(r.body.error, 'route_not_found');
      assert(f.calls.some(call => call.table === 'company_lead_routes')); assert.equal(f.fetches.length, 0);
    }
  });
}
test('inbound activity carries private message provenance when its parent contact is ordinary', async () => {
  const f = runtime('whatsapp-webhook', { role: 'owner', clientRoute: 'muscat', conversationRoute: 'investment' });
  f.rows.activities = [];
  const evidence = { conversationId: 'TEST-conversation', messageId: 'TEST-message', routeKey: 'investment', messageAt: '2026-10-19T20:00:01Z' };
  await f.ctx.logInboundActivity('TEST-client', OWNER, 'TEST-private-body', 'text', 0, false, evidence);
  assert.equal(f.rows.activities.length, 1);
  const activity = f.rows.activities[0];
  assert.equal(activity.client_id, 'TEST-client');
  assert.equal(activity.after_data.route_key, 'investment');
  assert.equal(activity.after_data.conversation_id, evidence.conversationId);
  assert.equal(activity.after_data.message_id, evidence.messageId);
  assert.equal(activity.actor_type, 'system'); assert.equal(activity.direction, 'inbound');
  assert.equal(activity.occurred_at, evidence.messageAt);
  assert.equal(activity.after_data.source_actor_type, 'customer');
  assert.equal(f.fetches.length, 0);
});
test('webhook AI context separates investment requests before pagination in both directions', async () => {
  const f = runtime('whatsapp-webhook', { requestRoute: 'investment', extraRequests: [
    { id: 'TEST-muscat', company_id: COMPANY, client_id: 'TEST-client', route_key: 'muscat', branch_key: 'muscat', status: 'active' },
    { id: 'TEST-barka', company_id: COMPANY, client_id: 'TEST-client', route_key: 'barka', branch_key: 'barka', status: 'active' },
    { id: 'TEST-unknown', company_id: COMPANY, client_id: 'TEST-client', route_key: null, branch_key: null, status: 'active' },
  ] });
  const investor = await f.ctx.getExistingRequests('TEST-client', 'investment');
  assert.equal(investor.length, 1); assert(investor.every(privateRow));
  for (const branch of ['muscat', 'barka', 'general']) {
    const regular = await f.ctx.getExistingRequests('TEST-client', branch);
    assert.equal(regular.length, 3); assert(regular.every(row => !privateRow(row)));
  }
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});
test('investment extraction cannot rewrite cached or hallucinated ordinary request IDs', () => {
  const f = runtime('whatsapp-webhook');
  const result = f.ctx.enforceInvestmentRequestBoundary({ requests: [
    { action: 'create', request_type: 'buyer', existing_request_id: 'TEST-old' },
    { action: 'update', request_type: 'buyer', existing_request_id: 'TEST-public' },
    { action: 'close', existing_request_id: 'TEST-public' },
    { action: 'update', request_type: 'buyer', existing_request_id: 'TEST-private' },
  ] }, [{ id: 'TEST-private', route_key: 'investment' }], 'investment');
  assert.equal(result.requests[0].request_type, 'investor'); assert.equal(result.requests[0].existing_request_id, null);
  assert.equal(result.requests[1].action, 'none'); assert.equal(result.requests[2].action, 'none'); assert.equal(result.needs_human_review, true);
  assert.equal(result.requests[3].action, 'update'); assert.equal(result.requests[3].request_type, 'investor');
  const ordinary = { requests: [{ action: 'update', request_type: 'buyer', existing_request_id: 'TEST-public' }] };
  assert.equal(f.ctx.enforceInvestmentRequestBoundary(ordinary, [], 'barka'), ordinary);
});
test('investment postprocess canonicalizes type/route and rejects stale manual/geographic staff routing', async () => {
  const f = runtime('whatsapp-webhook', { requestRoute: 'investment' });
  Object.assign(f.rows.client_requests[0], { request_type: 'buyer', route_key: 'general', branch_key: 'investment', manual_assigned_to: AGENT, preferred_area: 'الخوض', missing_required_fields: [] });
  await f.ctx.postProcessLinkedRequests({ clientId: 'TEST-client', conversationId: 'TEST-conversation', messageId: 'TEST-message', physicalRoute: 'investment' });
  const r = f.rows.client_requests[0];
  assert.equal(r.request_type, 'investor'); assert.equal(r.route_key, 'investment'); assert.equal(r.branch_key, 'investment'); assert.equal(r.assigned_to, OWNER); assert.equal(r.manual_assigned_to, null);
  assert(f.writes.every(write => write.table === 'client_requests')); assert.equal(f.fetches.length, 0);
});
test('missing investment owner fails closed before request mutation or automation', async () => {
  const f = runtime('whatsapp-webhook', { requestRoute: 'investment', ownerAssignment: null });
  await assert.rejects(f.ctx.postProcessLinkedRequests({ clientId: 'TEST-client', conversationId: 'TEST-conversation', messageId: 'TEST-message', physicalRoute: 'investment' }), /investment owner assignment missing/);
  assert.equal(f.writes.length, 0); assert.equal(f.fetches.length, 0);
});

function aiFixture(name, privateTarget = false) {
  const f = runtime(name, { role: 'owner', clientRoute: privateTarget ? 'investment' : 'muscat', requestRoute: 'muscat', conversationRoute: 'muscat' });
  f.rows.clients[0].name = 'PUBLIC-CLIENT';
  f.rows.clients.push({ id: 'TEST-private-client', company_id: COMPANY, lead_route: 'investment' });
  f.rows.client_requests.push({ ...f.rows.client_requests[0], id: 'TEST-private-request', route_key: 'investment', branch_key: 'investment', secret: 'PRIVATE-SENTINEL' });
  f.rows.whatsapp_conversations.push({ ...f.rows.whatsapp_conversations[0], id: 'TEST-private-conversation', route_key: 'investment' });
  const shared = { id: 'TEST-public-evidence', company_id: COMPANY, client_id: 'TEST-client', request_id: 'TEST-request', property_id: 'TEST-property', archived: false, notes: 'PUBLIC-EVIDENCE', status: 'done', has_inbound_inquiry: true, first_inquiry_at: '2026-01-01' };
  const secret = { ...shared, id: 'TEST-private-evidence', request_id: 'TEST-private-request', notes: 'PRIVATE-SENTINEL' };
  for (const table of ['property_inquiries', 'viewings', 'property_rejection_reasons', 'deals', 'crm_deals_access']) f.rows[table] = [structuredClone(shared), structuredClone(secret)];
  f.rows.whatsapp_messages = [
    { ...shared, conversation_id: 'TEST-conversation', body: 'PUBLIC-EVIDENCE' },
    { ...secret, conversation_id: 'TEST-private-conversation', body: 'PRIVATE-SENTINEL' },
    { ...shared, id: 'TEST-unlinked-private-message', request_id: null, conversation_id: 'TEST-private-conversation', body: 'PRIVATE-SENTINEL' },
  ];
  f.rows.properties = [{ id: 'TEST-property', company_id: COMPANY, branch_key: privateTarget ? 'investment' : 'muscat', archived: false, status: 'available', created_at: '2026-01-01' }];
  f.rows.crm_properties_access = structuredClone(f.rows.properties);
  f.rows.property_marketing_events = []; f.rows.property_action_reviews = [];
  const aiInputs = [];
  f.ctx.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const context = JSON.parse(options.body).input; aiInputs.push(context);
    // Synthetic AI deliberately echoes its entire context into the saved result.
    // If any private evidence reaches this call, the persisted cache test fails.
    return new Response(JSON.stringify({ output_text: JSON.stringify({ diagnosis: context, priority: 'low', summary: context, recommended_properties: [] }) }), { status: 200 });
  };
  return { ...f, aiInputs };
}
for (const name of ['property-ai-insights', 'client-ai-insights']) {
  test(`${name} owner run never persists investment evidence on a shared target`, async () => {
    const f = aiFixture(name);
    const r = await f.invoke(name === 'property-ai-insights' ? { property_id: 'TEST-property' } : { client_id: 'TEST-client' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true);
    assert.equal(f.aiInputs.length, 1); assert(!f.aiInputs[0].includes('PRIVATE-SENTINEL'));
    assert(f.aiInputs[0].includes('PUBLIC-EVIDENCE'));
    assert(!JSON.stringify(f.writes).includes('PRIVATE-SENTINEL'));
    assert.equal(f.fetches.length, 0);
  });
  test(`${name} owner private target retains its full investment evidence`, async () => {
    const f = aiFixture(name, true);
    const r = await f.invoke(name === 'property-ai-insights' ? { property_id: 'TEST-property' } : { client_id: 'TEST-client' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true);
    assert(f.aiInputs[0].includes('PRIVATE-SENTINEL')); assert.equal(f.fetches.length, 0);
  });
  test(`${name} ordinary evidence remains unchanged and unresolved context fails closed`, async () => {
    const f = aiFixture(name);
    const groups = { viewings: [structuredClone(f.rows.viewings[0])] };
    const result = await f.ctx.investmentSafeSharedEvidence(f.db, COMPANY, groups, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), groups);
    const privateResult = await f.ctx.investmentSafeSharedEvidence(f.db, COMPANY, { viewings: [{ ...groups.viewings[0], id: 'TEST-missing-view' }] }, false);
    assert.equal(privateResult.viewings.length, 0);
  });
}
test('shared client AI excludes private candidate properties and private property journeys', async () => {
  const f = aiFixture('client-ai-insights');
  f.rows.properties.push(
    { ...f.rows.properties[0], id: 'TEST-private-property', branch_key: 'investment', title: 'PRIVATE-SENTINEL-BRANCH' },
    { ...f.rows.properties[0], id: 'TEST-private-owner-property', owner_client_id: 'TEST-private-client', title: 'PRIVATE-SENTINEL-OWNER' },
  );
  f.rows.viewings.push({ ...f.rows.viewings[0], id: 'TEST-private-property-view', property_id: 'TEST-private-owner-property', notes: 'PRIVATE-SENTINEL-VIEW' });
  const r = await f.invoke({ client_id: 'TEST-client' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert(!f.aiInputs[0].includes('PRIVATE-SENTINEL'));
  assert(!JSON.stringify(f.writes).includes('PRIVATE-SENTINEL'));
});
test('property owned by private investment client retains owner-only AI context', async () => {
  const f = aiFixture('property-ai-insights');
  f.rows.crm_properties_access[0].owner_client_id = 'TEST-private-client';
  const r = await f.invoke({ property_id: 'TEST-property' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert(f.aiInputs[0].includes('PRIVATE-SENTINEL'));
});
for (const name of ['property-ai-insights', 'client-ai-insights']) {
  test(`${name} authoritative mask protects source-message, appointment and viewing-only privacy`, async () => {
    const f = aiFixture(name);
    f.rows.property_inquiries.push({ ...f.rows.property_inquiries[0], id: 'TEST-private-source-only', request_id: null, source_whatsapp_message_id: 'TEST-source-message', last_message: 'PRIVATE-SENTINEL-SOURCE' });
    f.rows.viewings.push({ ...f.rows.viewings[0], id: 'TEST-private-appointment-only', request_id: null, appointment_id: 'TEST-source-appointment', notes: 'PRIVATE-SENTINEL-APPOINTMENT' });
    for (const table of ['deals', 'crm_deals_access']) f.rows[table].push({ ...f.rows[table][0], id: 'TEST-private-viewing-only', request_id: null, viewing_id: 'TEST-source-viewing', notes: 'PRIVATE-SENTINEL-VIEWING' });
    const r = await f.invoke(name === 'property-ai-insights' ? { property_id: 'TEST-property' } : { client_id: 'TEST-client' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert(!f.aiInputs[0].includes('PRIVATE-SENTINEL'));
    const refs = f.calls.find(call => call.rpc === 'crm_shared_ai_evidence_mask').args.p_rows;
    for (const [table, id] of [['property_inquiries', 'TEST-private-source-only'], ['viewings', 'TEST-private-appointment-only'], ['deals', 'TEST-private-viewing-only']]) {
      assert(refs.some(ref => ref.table === table && ref.id === id));
    }
    assert(!JSON.stringify(f.writes).includes('PRIVATE-SENTINEL'));
  });
  test(`${name} nonowners keep RLS-scoped evidence without calling owner-only mask`, async () => {
    for (const role of ['agent', 'manager', 'viewer']) {
      const f = runtime(name, { role });
      const groups = { viewings: [{ id: 'TEST-ordinary-viewing', notes: 'ordinary visible evidence' }] };
      assert.equal(await f.ctx.investmentSafeSharedEvidence(f.db, COMPANY, groups, false), groups);
      assert.deepEqual(f.calls.filter(call => call.rpc).map(call => call.rpc), ['my_role']);
    }
  });
  test(`${name} mask failure stops before AI and shared cache writes`, async () => {
    const f = aiFixture(name), original = f.db.rpc;
    f.db.rpc = async (name, args) => name === 'crm_shared_ai_evidence_mask' ? { data: null, error: { message: 'TEST unavailable' } } : original(name, args);
    const r = await f.invoke(name === 'property-ai-insights' ? { property_id: 'TEST-property' } : { client_id: 'TEST-client' });
    assert.equal(r.status, 503); assert.equal(r.body.error, 'privacy_evidence_unavailable');
    assert.equal(f.aiInputs.length, 0); assert.equal(f.writes.length, 0);
  });
}
