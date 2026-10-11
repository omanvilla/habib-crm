'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/whatsapp-webhook/index.ts'), 'utf8');
const helpers = source.slice(source.indexOf('const BARKA_RE ='), source.indexOf('async function routeAssignments()'));
const postprocess = source.slice(source.indexOf('async function postProcessLinkedRequests('), source.indexOf('async function logInboundActivity('));
assert(helpers && postprocess, 'Exercise the deployed webhook routing function');
// This isolated slice has only parameter and local variable annotations. Avoid
// a compiler dependency or importing the Edge Function's real network clients.
const javascript = (helpers + postprocess)
  .replace('args: { clientId: string; conversationId: string; messageId: string; physicalRoute: string }', 'args')
  .replaceAll(': string[]', '').replaceAll(': string', '').replaceAll(': any', '');

const assignments = { muscat: 'TEST-muscat-agent', barka: 'TEST-barka-agent', investment: 'TEST-owner' };
function request(overrides = {}) {
  return {
    id: 'TEST-request', company_id: 'TEST-company', client_id: 'TEST-client',
    request_type: 'buyer', status: 'active', branch_key: 'general', route_key: 'general',
    assigned_to: assignments.muscat, manual_assigned_to: null, preferred_area: null,
    preferred_areas: [], alternative_areas: [], wilayat: null, property_type: null,
    property_types: [], budget_min: null, budget_max: null, payment_method: null,
    purchase_timing: null, bedrooms_min: null, missing_required_fields: [],
    last_requirements_prompt_fields: [], requirements_completed_at: null, ...overrides,
  };
}
function fixture(rows = [request()], { updateError = false, updateMissing = false, reloadError = false, routeMap = assignments } = {}) {
  const db = { client_requests: structuredClone(rows) }, calls = [], writes = [], automationChecks = [];
  let requestReads = 0;
  function from(table) {
    const call = { table, filters: [], operation: 'select' };
    const q = {
      select(columns) { call.columns = columns; return q; },
      eq(key, value) { call.filters.push([key, value]); return q; },
      in(key, value) { call.filters.push([key, value]); return q; },
      update(patch) { call.operation = 'update'; call.patch = structuredClone(patch); return q; },
      single() { call.single = true; return q; },
      then(resolve, reject) {
        calls.push(call);
        let result;
        if (table === 'whatsapp_message_requests') {
          result = { data: rows.map(row => ({ request_id: row.id })), error: null };
        } else if (table === 'client_requests') {
          const matched = db.client_requests.filter(row => call.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
          if (call.operation === 'update') {
            writes.push(call);
            if (updateError) result = { data: null, error: { message: 'TEST update rejected' } };
            else if (updateMissing) result = { data: null, error: null };
            else { matched.forEach(row => Object.assign(row, call.patch)); result = { data: matched.length ? { id: matched[0].id } : null, error: null }; }
          } else {
            requestReads++;
            result = reloadError && requestReads > 1 ? { data: null, error: { message: 'TEST reload rejected' } } : { data: structuredClone(matched), error: null };
          }
        } else {
          throw new Error('Unexpected write or read of ' + table + ': branch routing must not rewrite a contact or inbox');
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  }
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-11T08:00:00Z'])); } }
  const context = {
    Date: FixedDate, CRM_COMPANY_ID: 'TEST-company', supabase: { from },
    routeAssignments: async () => routeMap,
    autoSendRequirements: async args => { automationChecks.push(args); return { sent: false, reason: 'test_mode_off' }; },
    autoSendBuyerCompletion: async args => { automationChecks.push(args); return { sent: false, reason: 'test_mode_off' }; },
  };
  vm.createContext(context); vm.runInContext(javascript, context);
  return { db, calls, writes, automationChecks, run: physicalRoute => context.postProcessLinkedRequests({ clientId: 'TEST-client', conversationId: 'TEST-conversation', messageId: 'TEST-message', physicalRoute }) };
}

test('Barka inbound without a location stays with Barka instead of the old Muscat default', async () => {
  const f = fixture(); await f.run('barka');
  assert.equal(f.db.client_requests[0].branch_key, 'barka');
  assert.equal(f.db.client_requests[0].assigned_to, assignments.barka);
  assert(f.db.client_requests[0].missing_required_fields.includes('location'));
  assert.match(f.calls.find(call => call.table === 'client_requests' && call.operation === 'select').columns, /manual_assigned_to/);
  assert.deepEqual(f.writes[0].filters, [['id', 'TEST-request'], ['company_id', 'TEST-company']]);
  assert.equal(f.writes[0].single, true);
});

test('explicit Muscat geography through the Barka inbox routes the request but never reassigns the inbox', async () => {
  const f = fixture([request({ preferred_area: 'الخوض', branch_key: 'barka', route_key: 'barka' })]);
  await f.run('barka');
  assert.equal(f.db.client_requests[0].branch_key, 'muscat');
  assert.equal(f.db.client_requests[0].assigned_to, assignments.muscat);
  assert(f.calls.every(call => ['client_requests', 'whatsapp_message_requests'].includes(call.table)));
});

test('explicit manager assignment remains authoritative while collecting requirements', async () => {
  const f = fixture([request({ manual_assigned_to: 'TEST-manual-agent', assigned_to: 'TEST-manual-agent' })]);
  await f.run('barka');
  assert.equal(f.db.client_requests[0].assigned_to, 'TEST-manual-agent');
  assert.equal(f.db.client_requests[0].manual_assigned_to, 'TEST-manual-agent');
});

test('multiple requests retain separate geography without moving the shared client or physical conversation', async () => {
  const f = fixture([
    request({ id: 'TEST-barka-request', preferred_area: 'بركاء' }),
    request({ id: 'TEST-muscat-request', preferred_area: 'الخوض' }),
  ]);
  await f.run('barka');
  assert.deepEqual(f.db.client_requests.map(row => [row.branch_key, row.assigned_to]), [['barka', assignments.barka], ['muscat', assignments.muscat]]);
  assert.equal(f.writes.length, 2);
  assert(f.writes.every(call => call.table === 'client_requests'));
});

test('reprocessing the same linked request preserves branch, assignee and missing requirements', async () => {
  const f = fixture(); await f.run('barka');
  const first = structuredClone(f.db.client_requests);
  await f.run('barka');
  assert.deepEqual(f.db.client_requests, first);
  assert.equal(f.db.client_requests.length, 1);
});

test('unknown general inbox does not acquire a default Muscat branch or employee', async () => {
  const f = fixture([request({ assigned_to: null })]); await f.run('general');
  assert.equal(f.db.client_requests[0].branch_key, 'general');
  assert.equal(f.db.client_requests[0].assigned_to, null);
});

test('known existing branch survives a general inbox and investment stays owner routed', async () => {
  const existing = fixture([request({ branch_key: 'barka', route_key: 'barka', assigned_to: assignments.barka })]);
  await existing.run('general');
  assert.equal(existing.db.client_requests[0].branch_key, 'barka');
  assert.equal(existing.db.client_requests[0].assigned_to, assignments.barka);
  const investment = fixture([request({ preferred_area: 'الخوض' })]); await investment.run('investment');
  assert.equal(investment.db.client_requests[0].branch_key, 'investment');
  assert.equal(investment.db.client_requests[0].assigned_to, assignments.investment);
});

test('missing Barka routing assignment never falls back to the Muscat employee', async () => {
  const f = fixture([request()], { routeMap: { muscat: assignments.muscat } }); await f.run('barka');
  assert.equal(f.db.client_requests[0].branch_key, 'barka');
  assert.equal(f.db.client_requests[0].assigned_to, null);
});

test('failed or unacknowledged request update is surfaced before automation checks', async () => {
  for (const options of [{ updateError: true }, { updateMissing: true }]) {
    const f = fixture([request()], options);
    await assert.rejects(f.run('barka'), /postprocess request update/);
    assert.equal(f.automationChecks.length, 0);
  }
});

test('request reload failure is surfaced rather than silently reporting success', async () => {
  const f = fixture([request()], { reloadError: true });
  await assert.rejects(f.run('barka'), /postprocess request reload/);
  assert.equal(f.automationChecks.length, 0);
});
