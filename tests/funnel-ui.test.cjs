const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture(rpc) {
  const nodes = new Map();
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const item = { id, innerHTML: '', textContent: '', value: '', isConnected: true, dataset: {}, style: {}, classList: { contains: () => false },
      addEventListener() {}, replaceChildren() { this.innerHTML = ''; }, querySelector(selector) { return element(selector.replace(/^#/, '')); } };
    nodes.set(id, item); return item;
  }
  const context = { console, URL, document: { readyState: 'loading', addEventListener() {}, getElementById: element },
    currentProfile: { company_id: 'TEST-company' }, currentUser: { id: 'TEST-owner' }, canEdit: () => true, supa: { rpc } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../crm-funnel.js'), 'utf8'), context);
  return { context, element };
}

const property = (title = 'TEST Property') => ({ property_id: 'TEST-property', title, attributed_requests: 0, instagram_attributed_clients: 0,
  media: [{ id: 'TEST-media', url: 'https://instagram.com/reel/TEST/', views: null, reach: null, total_interactions: null }] });

test('RPC failure renders a retry error rather than a false zero dashboard', async () => {
  const { context, element } = fixture(async () => ({ error: { message: 'TEST denied by RLS' }, data: null }));
  await context.CRMFunnel.loadOverview();
  assert.match(element('igPerformanceContent').innerHTML, /تعذر تحميل البيانات/);
  assert.match(element('igPerformanceContent').innerHTML, /data-funnel-action="overview"/);
  assert.doesNotMatch(element('igPerformanceContent').innerHTML, /cf-metric/);
});

test('overview exposes missing metrics and escapes a property title without executable HTML', async () => {
  const { context, element } = fixture(async () => ({ data: { properties: [property('<img src=x onerror=TEST()>')], unresolved_total: 2 } }));
  await context.CRMFunnel.loadOverview();
  assert.match(element('igPerformanceContent').innerHTML, /غير متاح/);
  assert.match(element('igPerformanceContent').innerHTML, /ليس عدد أشخاص فريدًا/);
  assert.match(element('igPerformanceContent').innerHTML, /data-funnel-action="review"/);
  assert.match(element('cfPropertyResults').innerHTML, /&lt;img/);
  assert.doesNotMatch(element('cfPropertyResults').innerHTML, /<img src=x/);
});

test('a slower earlier load cannot replace a newer result', async () => {
  const pending = [];
  const { context, element } = fixture(() => new Promise(resolve => pending.push(resolve)));
  const first = context.CRMFunnel.loadOverview();
  const second = context.CRMFunnel.loadOverview();
  pending[1]({ data: { properties: [property('TEST latest')] } }); await second;
  pending[0]({ data: { properties: [property('TEST stale')] } }); await first;
  assert.match(element('cfPropertyResults').innerHTML, /TEST latest/);
  assert.doesNotMatch(element('cfPropertyResults').innerHTML, /TEST stale/);
});

test('logout/reset invalidates pending results from the previous user', async () => {
  let resolve;
  const { context, element } = fixture(() => new Promise(done => { resolve = done; }));
  const pending = context.CRMFunnel.loadOverview();
  context.CRMFunnel.reset(); context.currentUser = { id: 'TEST-other-user' };
  resolve({ data: { properties: [property('TEST private previous session')] } }); await pending;
  assert.equal(element('igPerformanceContent').innerHTML, '');
  assert.doesNotMatch(element('cfPropertyResults').innerHTML, /private previous session/);
});

test('property cohort keeps legacy inquiries outside rates and uses request denominators only', async () => {
  const p = { ...property(), attributed_clients: 7, legacy_inquiries_without_request: 5,
    conversion_cohort: { attributed_request_count: 4, qualified_request_count: 2, requests_with_booked_visit: 1, requests_with_completed_visit: 1, requests_with_closed_deal: 0 } };
  const { context, element } = fixture(async () => ({ data: { properties: [p] } }));
  element('pdAcquisitionFunnel').dataset.propertyId = p.property_id;
  await context.CRMFunnel.loadProperty(p.property_id);
  const html = element('pdAcquisitionFunnel').innerHTML;
  assert.match(html, /استفسارات بلا طلب مرتبط/);
  assert.match(html, /لا تدخل في نسب الطلبات/);
  assert.match(html, /max="100" value="50"/);
  assert.match(html, /ليست نسبة تحويل حصرية لإنستغرام/);
  assert.doesNotMatch(html, /value="28\.6"/);
});
