'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts', 'utf8');
const start = source.indexOf('    if (action === "link_message_request") {');
const end = source.indexOf('    if (action === "mark_read") {', start);
assert.ok(start >= 0 && end > start, 'Exercise the actual link action implementation');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const link = new AsyncFunction('action', 'payload', 'getConversation', 'userClient', 'admin', 'profile', 'user', 'companyId', 'json', source.slice(start, end));

function fixture({ role = 'agent', visible = true, requestError = null, requestClient = 'client', conversationVisible = true } = {}) {
  const calls = [], writes = [];
  const request = { id: 'request', client_id: requestClient, assigned_to: 'employee' };
  function client(scope) {
    return { from(table) {
      const filters = {}, call = { scope, table, filters };
      calls.push(call);
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        update(value) { call.update = value; return query; },
        async maybeSingle() {
          if (table === 'client_requests') return {
            data: !requestError && (scope === 'admin' || visible) && filters.client_id === request.client_id ? request : null,
            error: requestError,
          };
          if (table === 'whatsapp_messages') return { data: { id: 'message', direction: 'inbound' }, error: null };
          throw new Error('Unexpected lookup ' + table);
        },
        then(resolve, reject) {
          if (call.update) writes.push(call);
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return query;
    } };
  }
  return { calls, writes, run: (override = {}) => link('link_message_request', {
    conversation_id: 'conversation', message_id: 'message', request_id: 'request', ...override,
  }, async () => conversationVisible ? { id: 'conversation', client_id: 'client' } : null,
  client('user'), client('admin'), { role }, { id: 'employee' }, 'company', (body, status = 200) => ({ body, status })) };
}

test('hidden cross-branch request cannot be linked even with a stale employee assignment', async () => {
  const f = fixture({ visible: false });
  const result = await f.run();
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'request_not_found');
  assert.equal(f.writes.length, 0);
});

for (const role of ['owner', 'manager', 'agent']) {
  test(role + ' can link a request authorized by the caller policies', async () => {
    const f = fixture({ role });
    const result = await f.run();
    assert.equal(result.status, 200);
    assert.equal(result.body.request_id, 'request');
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].update, { request_id: 'request' });
    assert.deepEqual(f.writes[0].filters, { id: 'message', company_id: 'company' });
    const requestRead = f.calls.find(x => x.table === 'client_requests');
    assert.equal(requestRead.scope, 'user');
    assert.deepEqual(requestRead.filters, { id: 'request', company_id: 'company', client_id: 'client' });
  });
}

test('request lookup failure or another client never causes an update', async () => {
  for (const args of [{ requestError: { message: 'lookup unavailable' } }, { requestClient: 'another-client' }]) {
    const f = fixture(args);
    assert.equal((await f.run()).status, 404);
    assert.equal(f.writes.length, 0);
  }
});

test('hidden conversation is rejected before target request lookup', async () => {
  const f = fixture({ conversationVisible: false });
  assert.equal((await f.run()).status, 404);
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});
