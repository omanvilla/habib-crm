const test = require('node:test');
const assert = require('node:assert/strict');
const serviceModule = import('../supabase/functions/_shared/property-inquiry-service.mjs');

const baseTime = Date.parse('2026-10-15T10:00:00Z');
const at = minutes => new Date(baseTime + minutes * 60000).toISOString();
const property = (id = 'p1', extra = {}) => ({ id, title: 'فيلا الخوض السابعة 135', area: 'الخوض السابعة', price: 135000, ...extra });
const message = (id, body, extra = {}) => ({ id, company_id: 'company', client_id: 'client', conversation_id: 'conversation',
  whatsapp_message_id: `wamid.${id}`, direction: 'inbound', body, message_type: 'text', message_timestamp: at(0),
  actor_type: null, delivery_status: null, ...extra });
const outgoing = (id, body, minutes = 1, extra = {}) => message(id, body, { direction: 'outbound', actor_type: 'human',
  delivery_status: 'sent', message_timestamp: at(minutes), ...extra });

function fixture({ messages = [], candidates = [property()], conversation = {}, rpcError, fetchImpl, applyResult, candidatePages } = {}) {
  const tables = { whatsapp_messages: structuredClone(messages), whatsapp_conversations: [{ id: 'conversation', company_id: 'company',
    client_id: 'client', route_key: 'muscat', human_handoff_required: false, handoff_reason: null, ...conversation }], unmatched_property_links: [] };
  const calls = [], aiCalls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.operation = 'select'; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this; }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
    order(key, options) { this.orders.push([key, options.ascending]); return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    update(value) { this.operation = 'update'; this.value = value; return this; }
    upsert(value, options) { this.operation = 'upsert'; this.value = value; this.options = options; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => {
      calls.push({ table: this.table, operation: this.operation, value: this.value });
      let rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      for (const [key, ascending] of [...this.orders].reverse()) rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1));
      if (this.bounds) rows = rows.slice(this.bounds[0], this.bounds[1] + 1);
      if (this.operation === 'update') rows.forEach(row => Object.assign(row, this.value));
      if (this.operation === 'upsert') {
        const keys = this.options.onConflict.split(',');
        if (!tables[this.table].some(row => keys.every(key => row[key] === this.value[key]))) tables[this.table].push(structuredClone(this.value));
      }
      return { data: structuredClone(this.single ? rows[0] || null : rows), error: null };
    }).then(resolve, reject); }
  }
  const db = { from: table => new Query(table), rpc: async (name, args) => {
    calls.push({ rpc: name, args });
    if (rpcError && (rpcError === true || rpcError === name)) return { error: { message: 'synthetic database failure' } };
    if (name === 'crm_property_inquiry_candidates') {
      const offset = args.p_offset, count = args.p_limit;
      return { data: candidatePages ? candidatePages(offset, count) : { candidates: candidates.slice(offset, offset + count), has_more: candidates.length > offset + count } };
    }
    if (name === 'crm_apply_verified_property_inquiries') return { data: applyResult || {
      matched_count: args.p_matches.length, property_ids: args.p_matches.map(match => match.property_id), review_required: args.p_needs_review,
    } };
    throw new Error(`Unexpected RPC ${name}`);
  } };
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body); aiCalls.push({ url, request });
    if (fetchImpl) return fetchImpl(url, options);
    const input = JSON.parse(request.input);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ answers_inquiry: true, confidence: .97,
      anchor_quote: input.anchor.text, response_quote: input.staff_response.text,
      property_ids: input.verified_listing_references.map(match => match.property_id),
    }) }) };
  };
  return { tables, calls, aiCalls, service: async options => (await serviceModule).createPropertyInquiryService({ db, companyId: 'company', apiKey: 'synthetic-key', model: 'test-model', fetchImpl: fetcher, ...options }),
    applied: () => calls.filter(call => call.rpc === 'crm_apply_verified_property_inquiries'),
  };
}

test('direct specific area and abbreviated price preserve inbound provenance without model guessing', async () => {
  const f = fixture({ messages: [message('m1', 'ممكن تفاصيل فيلا الخوض 135 ألف')] });
  const result = await (await f.service()).attributeInbound('m1');
  assert.equal(result.matched_count, 1); assert.equal(f.aiCalls.length, 0);
  const call = f.applied()[0].args;
  assert.equal(call.p_message_id, 'm1');
  assert.deepEqual(call.p_matches[0].evidence.source_message_ids, ['m1']);
  assert.equal(call.p_matches[0].evidence.kind, 'text');
  assert.equal(call.p_matches[0].evidence.matched_facts.price, 135000);
  assert.equal(call.p_matches[0].method, 'ai_verified');
  assert.equal(f.calls.some(call => call.operation === 'update'), false);
});

test('complete candidate pagination finds inventory beyond the former 80-row limit', async () => {
  const candidates = Array.from({ length: 201 }, (_, i) => property(`p${i}`, { price: 100000 + i, property_code: `LIST-${i}` }));
  const f = fixture({ candidates, messages: [message('m1', 'ممكن تفاصيل العقار LIST-200')] });
  assert.deepEqual((await (await f.service()).attributeInbound('m1')).property_ids, ['p200']);
  assert.deepEqual(f.calls.filter(call => call.rpc === 'crm_property_inquiry_candidates').map(call => call.args.p_offset), [0, 100, 200]);
  assert.equal(f.calls.some(call => call.table === 'properties'), false, 'catalog is obtained through the authoritative private scope RPC');
});

test('exact saved link works without requiring extra customer words', async () => {
  const f = fixture({ candidates: [property('p1', { marketing_urls: ['https://www.instagram.com/reel/AbCd123/'] })],
    messages: [message('m1', 'https://instagram.com/reel/AbCd123/?igsh=x')] });
  assert.equal((await (await f.service()).attributeInbound('m1')).matched_count, 1);
});

test('a generic area budget request waits for a staff response without fake attribution', async () => {
  const f = fixture({ messages: [message('m1', 'ابحث عن فيلا في الخوض ميزانيتي 135 ألف')] });
  const result = await (await f.service()).attributeInbound('m1');
  assert.equal(result.matched_count, 0); assert.equal(result.awaiting_staff_response, true);
  assert.equal(f.applied().length, 0); assert.equal(f.tables.unmatched_property_links.length, 0);
});

test('duplicate area/price evidence becomes one durable review alert preserving existing reason', async () => {
  const f = fixture({ candidates: [property('p1'), property('p2')], messages: [message('m1', 'ممكن تفاصيل فيلا الخوض 135 ألف')],
    conversation: { human_handoff_required: true, handoff_reason: 'Existing owner review' } });
  const service = await f.service();
  assert.equal((await service.attributeInbound('m1')).review_required, true);
  await service.attributeInbound('m1');
  assert.equal(f.tables.unmatched_property_links.length, 1); assert.equal(f.applied().length, 0);
  assert.equal(f.tables.whatsapp_conversations[0].handoff_reason, 'Existing owner review');
});

test('listing OCR needs independent inventory evidence and confirmed non-document classification', async () => {
  const f = fixture({ messages: [message('m1', null, { message_type: 'image' })] });
  const result = await (await f.service()).attributeInbound('m1', { imageEvidence: {
    visible_text: 'فيلا للبيع في الخوض 135 ألف', is_property_listing: true, is_property_document: false, confidence: .98,
  } });
  assert.equal(result.matched_count, 1); assert.equal(f.applied()[0].args.p_matches[0].evidence.kind, 'image');
  assert.deepEqual(f.applied()[0].args.p_matches[0].evidence.source_message_ids, ['m1']);
  const uncertain = fixture({ messages: [message('m2', null, { message_type: 'image' })] });
  assert.equal((await (await uncertain.service()).attributeInbound('m2', { imageEvidence: {
    visible_text: 'الخوض 135 ألف', is_property_listing: true, confidence: .7,
  } })).review_required, true);
  assert.equal(uncertain.applied().length, 0);
  const doc = fixture({ messages: [message('m3', 'الخوض 135 ألف', { message_type: 'image' })] });
  assert.equal((await (await doc.service()).attributeInbound('m3', { imageEvidence: {
    visible_text: 'الخوض 135 ألف', is_property_listing: true, is_property_document: true, confidence: 1,
  } })).blocked_reason, 'property_document');
  assert.equal(doc.applied().length, 0);
});

test('unrecognizable photo is queued while high-confidence unrelated image is ignored', async () => {
  const f = fixture({ messages: [message('m1', null, { message_type: 'image' })] });
  assert.equal((await (await f.service()).attributeInbound('m1')).review_required, true);
  const unrelated = fixture({ messages: [message('m2', null, { message_type: 'image' })] });
  assert.equal((await (await unrelated.service()).attributeInbound('m2', { imageEvidence: {
    is_property_listing: false, is_property_document: false, confidence: .99,
  } })).review_required, false);
});

test('inbound literal reply can use the exact recent human listing with no temporal guess', async () => {
  const f = fixture({ messages: [outgoing('old', 'فيلا للبيع في الخوض 135 ألف', -20),
    message('m1', 'كم السعر', { reply_to_message_id: 'wamid.old' })] });
  assert.equal((await (await f.service()).attributeInbound('m1')).matched_count, 1);
  assert.deepEqual(f.applied()[0].args.p_matches[0].evidence.source_message_ids, ['m1', 'old']);
  assert.equal(f.applied()[0].args.p_matches[0].evidence.kind, 'conversation');
  assert.equal(f.aiCalls.length, 0);
  for (const overrides of [{ message_timestamp: at(-1500) }, { client_id: 'another-client' }, { actor_type: 'automated' }]) {
    const denied = fixture({ messages: [outgoing('old', 'فيلا للبيع في الخوض 135 ألف', -20, overrides),
      message('m1', 'كم السعر', { reply_to_message_id: 'wamid.old' })] });
    assert.equal((await (await denied.service()).attributeInbound('m1')).matched_count, 0);
  }
});

test('a thanks/rejection quote does not manufacture an inbound inquiry', async () => {
  for (const body of ['شكرا', 'لا شكرا ما اريد']) {
    const f = fixture({ messages: [outgoing('old', 'فيلا للبيع في الخوض 135 ألف', -1), message('m1', body, { reply_to_message_id: 'wamid.old' })] });
    assert.equal((await (await f.service()).attributeInbound('m1')).matched_count, 0);
    assert.equal(f.applied().length, 0);
  }
});

test('staff answer to genuine area inquiry verifies relation and records every clearly offered listing', async () => {
  const f = fixture({ candidates: [property('p1'), property('p2', { title: 'فيلا الموالح', area: 'الموالح', price: 120000 })],
    messages: [message('ask', 'عندكم فلل في الخوض أو الموالح'), outgoing('answer', 'فيلا الخوض 135 ألف\nوفيلا الموالح 120 ألف')] });
  const result = await (await f.service()).attributeOutbound('answer');
  assert.deepEqual(result.property_ids, ['p1', 'p2']); assert.equal(f.aiCalls.length, 1);
  assert.equal(f.aiCalls[0].request.store, false); assert.equal(f.aiCalls[0].request.text.format.strict, true);
  assert.equal(f.applied()[0].args.p_message_id, 'ask');
  assert.deepEqual(f.applied()[0].args.p_matches[0].evidence.source_message_ids, ['ask', 'answer']);
});

test('unsolicited listing or greeting-only conversation never invokes AI nor writes inquiries', async () => {
  for (const body of ['السلام عليكم', 'شكرا']) {
    const f = fixture({ messages: [message('greeting', body), outgoing('answer', 'فيلا الخوض 135 ألف')] });
    assert.equal((await (await f.service()).attributeOutbound('answer')).blocked_reason, 'no_genuine_inbound_ask');
    assert.equal(f.aiCalls.length, 0); assert.equal(f.applied().length, 0);
  }
});

test('automated/failed outbound and an unproven vague description cannot create inquiries', async () => {
  for (const extra of [{ actor_type: 'automated' }, { delivery_status: 'failed' }]) {
    const f = fixture({ messages: [message('ask', 'عندكم فلل في الخوض'), outgoing('answer', 'فيلا الخوض 135 ألف', 1, extra)] });
    assert.equal((await (await f.service()).attributeOutbound('answer')).matched_count, 0);
    assert.equal(f.aiCalls.length, 0);
  }
  const vague = fixture({ messages: [message('ask', 'عندكم فلل في الخوض'), outgoing('answer', 'نعم موجود تفضل')] });
  assert.equal((await (await vague.service()).attributeOutbound('answer')).blocked_reason, 'response_listing_unproven');
  assert.equal(vague.aiCalls.length, 0);
});

test('response after rejection is blocked and a later new alternative ask becomes the only anchor', async () => {
  const denied = fixture({ messages: [message('ask', 'ممكن موقع البيت'), outgoing('unavailable', 'ما متوفره هذي', 1), outgoing('answer', 'فيلا الخوض 135 ألف', 3)] });
  assert.equal((await (await denied.service()).attributeOutbound('answer')).matched_count, 0);
  assert.equal(denied.applied().length, 0);
  const valid = fixture({ messages: [message('ask', 'ممكن موقع البيت'), outgoing('unavailable', 'ما متوفره هذي', 1),
    message('alternative', 'عندكم فلل في الخوض', { message_timestamp: at(2) }), outgoing('answer', 'فيلا الخوض 135 ألف', 3)] });
  assert.equal((await (await valid.service()).attributeOutbound('answer')).matched_count, 1);
  assert.equal(valid.applied()[0].args.p_message_id, 'alternative');
});

test('genuine overnight response is verified within 24h; neither ordinary nor quoted replies exceed that bound', async () => {
  const messages = [message('ask', 'عندكم فلل في الخوض'), outgoing('answer', 'فيلا الخوض 135 ألف', 19 * 60)];
  const overnight = fixture({ messages });
  assert.equal((await (await overnight.service()).attributeOutbound('answer')).matched_count, 1);
  assert.equal(overnight.aiCalls.length, 1, 'overnight proximity alone never bypasses relationship verification');
  messages[1].reply_to_message_id = 'wamid.ask';
  const explicit = fixture({ messages });
  assert.equal((await (await explicit.service()).attributeOutbound('answer')).matched_count, 1);
  assert.equal(explicit.aiCalls.length, 0);
  messages[1].message_timestamp = at(24 * 60 + 1);
  for (const quote of ['wamid.ask', null]) {
    messages[1].reply_to_message_id = quote;
    const expired = fixture({ messages });
    assert.equal((await (await expired.service()).attributeOutbound('answer')).matched_count, 0);
    assert.equal(expired.aiCalls.length, 0);
  }
});

test('model cannot pick absent properties or invent supporting quotes regardless of confidence', async () => {
  for (const override of [{ property_ids: ['unseen-property'] }, { anchor_quote: 'invented' }, { confidence: .92 }]) {
    const f = fixture({ messages: [message('ask', 'عندكم فلل في الخوض'), outgoing('answer', 'فيلا الخوض 135 ألف')],
      fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ answers_inquiry: true, confidence: 1,
        anchor_quote: 'عندكم فلل في الخوض', response_quote: 'فيلا الخوض 135 ألف', property_ids: ['p1'], ...override }) }) }) });
    assert.equal((await (await f.service()).attributeOutbound('answer')).review_required, true);
    assert.equal(f.applied().length, 0);
  }
});

test('model and RPC failures queue staff review and propagate for retry instead of reporting success', async () => {
  const modelFailure = fixture({ messages: [message('ask', 'عندكم فلل في الخوض'), outgoing('answer', 'فيلا الخوض 135 ألف')],
    fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects((await modelFailure.service()).attributeOutbound('answer'), /ai_http_503/);
  assert.equal(modelFailure.tables.unmatched_property_links.length, 1);
  const rpcFailure = fixture({ messages: [message('ask', 'ممكن تفاصيل فيلا الخوض 135 ألف')], rpcError: 'crm_apply_verified_property_inquiries' });
  await assert.rejects((await rpcFailure.service()).attributeInbound('ask'), /synthetic database failure/);
  assert.equal(rpcFailure.tables.unmatched_property_links.length, 1);
  assert.equal(rpcFailure.tables.whatsapp_conversations[0].human_handoff_required, true);
});

test('database blocking is surfaced as review and never replaced with direct recorder writes', async () => {
  const f = fixture({ messages: [message('ask', 'ممكن تفاصيل فيلا الخوض 135 ألف')],
    applyResult: { matched_count: 0, property_ids: [], review_required: true, blocked_reason: 'protected_parent_route' } });
  assert.equal((await (await f.service()).attributeInbound('ask')).blocked_reason, 'protected_parent_route');
  assert.equal(f.tables.unmatched_property_links.length, 1);
  assert.equal(f.calls.some(call => call.rpc === 'record_property_link_inquiry_internal'), false);
});

test('re-read rejects cross-company/client conversation mismatch before any catalog or AI lookup', async () => {
  for (const overrides of [{ company_id: 'another-company' }, { client_id: 'different-client' }]) {
    const f = fixture({ messages: [message('m1', 'ممكن تفاصيل فيلا الخوض 135 ألف', overrides)] });
    assert.equal((await (await f.service()).attributeInbound('m1')).blocked_reason, 'invalid_inbound_anchor');
    assert.equal(f.calls.some(call => call.rpc), false); assert.equal(f.aiCalls.length, 0);
  }
});

test('review preserves valid multiple/partial match status and stored vision evidence survives replay', async () => {
  for (const status of ['multiple_matched', 'partial_match']) {
    const f = fixture({ messages: [message('m1', 'عقار يحتاج مراجعة', { property_match_status: status })] });
    await (await f.service()).queueReview('m1');
    assert.equal(f.tables.whatsapp_messages[0].property_match_status, status);
  }
  const stored = fixture({ messages: [message('image', null, { message_type: 'image', property_image_analysis: {
    vision_version: 2, is_property_listing: true, is_property_document: false, confidence: .99, visible_text: 'فيلا الخوض 135 ألف',
  } })] });
  assert.equal((await (await stored.service()).attributeInbound('image')).matched_count, 1);
});

test('unavailability in current response cannot attach an alternative listing to the old inquiry', async () => {
  for (const denial of ['ما متوفره هذي', 'ما متوفرة هذه', 'غير متوفرة', 'تم البيع']) {
    const f = fixture({ messages: [message('ask', 'ممكن موقع البيت'), outgoing('answer', `${denial} ولكن عندنا فيلا الخوض 135 ألف`)] });
    assert.equal((await (await f.service()).attributeOutbound('answer')).blocked_reason, 'response_rejection_or_unavailable');
    assert.equal(f.applied().length, 0); assert.equal(f.aiCalls.length, 0);
  }
});

test('customer exact known listing is not replaced by a different staff listing', async () => {
  const f = fixture({ candidates: [property('asked', { marketing_urls: ['https://instagram.com/reel/Asked123/'] }),
    property('offered', { area: 'الموالح', price: 120000, title: 'فيلا الموالح 120' })], messages: [
    message('ask', 'https://instagram.com/reel/Asked123/'), outgoing('answer', 'فيلا الموالح 120 ألف'),
  ] });
  assert.equal((await (await f.service()).attributeOutbound('answer')).blocked_reason, 'conflicting_explicit_property');
  assert.equal(f.applied().length, 0); assert.equal(f.aiCalls.length, 0);
});

test('location question quoting a known listing photo inherits its exact conflict protection', async () => {
  const f = fixture({ candidates: [property('asked'), property('offered', { area: 'الموالح', price: 120000, title: 'فيلا الموالح 120' })], messages: [
    message('photo', null, { message_type: 'image', matched_property_id: 'asked' }),
    message('ask', 'الموقع', { message_timestamp: at(1), reply_to_message_id: 'wamid.photo' }),
    outgoing('answer', 'فيلا الموالح 120 ألف', 2),
  ] });
  assert.equal((await (await f.service()).attributeOutbound('answer')).blocked_reason, 'conflicting_explicit_property');
  assert.equal(f.applied().length, 0);
});

test('split customer link then details question retains explicit property choice against a different staff link', async () => {
  const candidates = [property('asked', { marketing_urls: ['https://instagram.com/reel/Asked123/'] }),
    property('offered', { area: 'الموالح', price: 120000, title: 'فيلا الموالح 120', marketing_urls: ['https://instagram.com/reel/Offered123/'] })];
  const messages = [message('link', 'https://instagram.com/reel/Asked123/'),
    message('ask', 'ممكن تفاصيل', { message_timestamp: at(1) }), outgoing('answer', 'https://instagram.com/reel/Offered123/', 2)];
  for (const question of ['ممكن تفاصيل', 'ممكن التفاصيل', 'لو سمحت تبعتيلى الموقع']) {
    messages[1].body = question;
    const f = fixture({ candidates, messages });
    assert.equal((await (await f.service()).attributeOutbound('answer')).blocked_reason, 'conflicting_explicit_property');
    assert.equal(f.applied().length, 0); assert.equal(f.aiCalls.length, 0, 'even a falsely-positive model cannot override the customer-selected listing');
  }
  messages[1].body = 'عندكم بيوت ثانية';
  const alternative = fixture({ candidates, messages });
  assert.equal((await (await alternative.service()).attributeOutbound('answer')).matched_count, 1);
  assert.equal(alternative.applied()[0].args.p_message_id, 'ask');
  assert.equal(alternative.aiCalls.length, 1, 'a new alternative request is independently verified');
});

test('an inbound question quoting a rejected/unavailable staff listing never attributes it', async () => {
  const f = fixture({ messages: [outgoing('old', 'ما متوفرة هذه فيلا الخوض 135 ألف', -1),
    message('ask', 'كم السعر', { reply_to_message_id: 'wamid.old' })] });
  assert.equal((await (await f.service()).attributeInbound('ask')).matched_count, 0);
  assert.equal(f.applied().length, 0);
});

test('forwarded advertisement CTA is not a customer inquiry; genuine prefixed question and bare link still work', async () => {
  const ad = 'فيلا للبيع في الخوض 135 ألف\nمساحة الأرض 300 متر\n4 غرف وصالة ومطبخ\nللاستفسار وطلب الموقع تواصل معنا\nhttps://instagram.com/reel/Asked123/';
  const candidates = [property('p1', { marketing_urls: ['https://instagram.com/reel/Asked123/'] })];
  const f = fixture({ candidates, messages: [message('advert', ad), outgoing('answer', ad)] });
  const service = await f.service();
  assert.equal((await service.attributeInbound('advert')).blocked_reason, 'advertisement_without_customer_question');
  assert.equal((await service.attributeOutbound('answer')).blocked_reason, 'no_genuine_inbound_ask');
  assert.equal(f.applied().length, 0); assert.equal(f.aiCalls.length, 0);
  for (const body of [`ممكن تفاصيل هذا العقار؟\n${ad}`, 'https://instagram.com/reel/Asked123/']) {
    const genuine = fixture({ candidates, messages: [message('ask', body), outgoing('answer', 'فيلا الخوض 135 ألف')] });
    assert.equal((await (await genuine.service()).attributeInbound('ask')).matched_count, 1);
  }
});
