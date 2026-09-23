const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function fixture(handler) {
  const events = [], nodes = new Map(), toasts = [];
  const persisted = new Map();
  const storage = { getItem: key => persisted.get(key) || null, setItem: (key, value) => persisted.set(key, value), removeItem: key => persisted.delete(key) };
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    let html = '';
    const item = { id, value: '', style: {}, disabled: false, scrollHeight: 100,
      get innerHTML() { return html; }, set innerHTML(value) { html = value; events.push('render:' + id); } };
    nodes.set(id, item); return item;
  }
  const context = { console, URLSearchParams, crypto: webcrypto, TextEncoder, localStorage: storage, sessionStorage: storage,
    currentProfile: { company_id: 'TEST-company' }, currentUser: { id: 'TEST-owner' }, document: { readyState: 'loading', addEventListener() {}, getElementById: element },
    isOwner: () => false, showToast: (text, type) => toasts.push({ text, type }),
    supa: { functions: { invoke: async (_, { body }) => { events.push(body.action); return handler(body); } } } };
  context.window = context;
  vm.createContext(context);
  // The original closure is exposed only inside this isolated test VM. No test
  // hooks or fake credentials are added to the deployed browser source.
  const source = fs.readFileSync(path.join(__dirname, '../instagram-crm.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__test = {openInstagramConversation, sendInstagramMessage, setActive: c => {igActiveConversation=c;}, getActive:()=>igActiveConversation};})();');
  vm.runInContext(source, context);
  return { context, element, events, toasts, persisted };
}

function defaultResponse(body) {
  if (body.action === 'status') return { data: { ok: true, connected: true, account: { username: 'TEST-account', webhook_subscribed: true } } };
  if (body.action === 'list') return { data: { ok: true, conversations: [], unread_total: 0 } };
  return { data: { ok: true } };
}

test('messages render before read marking and the newest ingestion sequence is the watermark', async () => {
  let cursor;
  const { context, events } = fixture(async body => {
    if (body.action === 'conversation') return { data: { ok: true, conversation: { id: 'TEST-conv', participant_name: 'TEST' }, messages: [
      { id: 'TEST-delayed', ingestion_seq: 11, message_timestamp: '2026-09-21T09:00:00Z', body: 'TEST delayed' },
      { id: 'TEST-newer-time', ingestion_seq: 10, message_timestamp: '2026-09-23T09:00:00Z', body: 'TEST newer event time' }
    ] } };
    if (body.action === 'mark_read') cursor = body.through_message_id;
    return defaultResponse(body);
  });
  await context.__test.openInstagramConversation('TEST-conv');
  assert.equal(cursor, 'TEST-delayed');
  assert.ok(events.indexOf('render:igMessages') < events.indexOf('mark_read'));
  assert.ok(events.includes('list'), 'Refresh server unread counts after the watermark');
  assert.ok(!events.includes('send'));
});

test('accepted external send with local persistence failure clears the draft and explicitly forbids resend', async () => {
  const { context, element, events, toasts } = fixture(async body => {
    assert.equal(body.action, 'send');
    return { data: { ok: false, sent: true, recorded: false, retry_safe: false, error: 'message_sent_but_local_save_failed' } };
  });
  context.__test.setActive({ id: 'TEST-conv' });
  element('igReply').value = 'TEST no external message';
  await context.__test.sendInstagramMessage();
  assert.equal(element('igReply').value, '');
  assert.equal(element('igSendBtn').disabled, false);
  assert.equal(events.filter(x => x === 'send').length, 1);
  assert.match(toasts.at(-1).text, /تم إرسال الرسالة/);
  assert.match(toasts.at(-1).text, /لا تعِد إرسالها/);
});

test('repeated send events while the first request is pending do not submit twice', async () => {
  let finish, started;
  const sendStarted = new Promise(resolve => { started = resolve; });
  const { context, element, events } = fixture(body => body.action === 'send' ? new Promise(resolve => { finish = resolve; started(); }) : defaultResponse(body));
  context.__test.setActive({ id: 'TEST-conv' }); element('igReply').value = 'TEST';
  const first = context.__test.sendInstagramMessage();
  await context.__test.sendInstagramMessage();
  await sendStarted;
  assert.equal(events.filter(x => x === 'send').length, 1);
  finish({ error: { message: 'TEST disconnected before confirmation' } }); await first;
  assert.equal(element('igReply').value, 'TEST');
});

test('an uncertain send retains one operation ID without persisting the message body', async () => {
  const ids = [];
  const { context, element, persisted, toasts } = fixture(async body => {
    ids.push(body.operation_id);
    return { error: { message: 'HTTP 409', context: { json: async () => ({ ok: false, sent: null, retry_safe: false, error: 'send_status_requires_review' }) } } };
  });
  context.__test.setActive({ id: 'TEST-conv' }); element('igReply').value = 'TEST PRIVATE BODY';
  await context.__test.sendInstagramMessage();
  await context.__test.sendInstagramMessage();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify([...persisted]), /TEST PRIVATE BODY/);
  assert.equal(element('igReply').value, 'TEST PRIVATE BODY');
  assert.match(toasts.at(-1).text, /حالة الإرسال تحتاج مراجعة/);
});

test('a slower conversation result never replaces the selected conversation', async () => {
  let old;
  const { context, element } = fixture(body => {
    if (body.action === 'conversation' && body.conversation_id === 'TEST-old') return new Promise(resolve => { old = resolve; });
    if (body.action === 'conversation') return { data: { ok: true, conversation: { id: 'TEST-new', participant_name: 'TEST new' }, messages: [] } };
    return defaultResponse(body);
  });
  const first = context.__test.openInstagramConversation('TEST-old');
  await context.__test.openInstagramConversation('TEST-new');
  old({ data: { ok: true, conversation: { id: 'TEST-old', participant_name: 'TEST old' }, messages: [] } }); await first;
  assert.equal(context.__test.getActive().id, 'TEST-new');
  assert.match(element('igChatHead').innerHTML, /TEST new/);
  assert.doesNotMatch(element('igChatHead').innerHTML, /TEST old/);
});
