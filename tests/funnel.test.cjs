const test = require('node:test');
const assert = require('node:assert/strict');
const funnel = require('../crm-funnel.js');

test('the same Reel across properties, duplicate events and URL aliases is counted once', () => {
  const stats = funnel.summarizeMedia([
    { id: 'old', url: 'https://instagram.com/reel/AB_1/?igsh=old', views: 80, reach: 30, total_interactions: 7, last_synced_at: '2026-09-20T00:00:00Z' },
    { id: 'new', media_id: '1', url: 'https://www.instagram.com/p/AB_1/', views: 120, reach: 50, total_interactions: 12, last_synced_at: '2026-09-23T00:00:00Z' },
    { id: 'other-property', media_id: '1', url: 'https://www.instagram.com/reel/AB_1/', views: 120, reach: 50, total_interactions: 12, last_synced_at: '2026-09-23T00:00:00Z' },
    { id: 'two', media_id: '2', url: 'https://instagram.com/reel/AB_2/', views: 200, reach: 90, total_interactions: 20 },
  ]);
  assert.equal(stats.media_count, 2);
  assert.equal(stats.views, 320);
  assert.equal(stats.reach_non_unique, 140);
  assert.equal(stats.interactions, 32);
});

test('unavailable metrics stay null, zero remains a valid measurement and partial coverage is explicit', () => {
  const stats = funnel.summarizeMedia([
    { id: 'a', views: null, reach: null },
    { id: 'b', views: 0, reach: null },
    { id: 'c', views: -1, reach: NaN },
  ]);
  assert.equal(stats.views, 0);
  assert.equal(stats.known.views, 1);
  assert.equal(stats.reach_non_unique, null);
  assert.equal(stats.interactions, null);
  assert.equal(funnel.summarizeMedia([]).views, null);
});

test('ratios reject incompatible or empty populations rather than displaying a fake percent', () => {
  assert.equal(funnel.cohortRate(2, 8), 25);
  assert.equal(funnel.cohortRate(0, 8), 0);
  assert.equal(funnel.cohortRate(1, 3), 33.3);
  [ [0, 0], [9, 8], [null, 8], [1, undefined], [-1, 8], ['text', 8] ].forEach(([n, d]) => assert.equal(funnel.cohortRate(n, d), null));
});

test('only real Instagram permalinks are accepted and duplicate tracking URLs collapse', () => {
  const result = funnel.parseLinks('https://instagram.com/reel/TEST_1/?igsh=x\n\nhttps://www.instagram.com/p/TEST_1/\nhttps://www.instagram.com/reels/TEST_2/\njavascript:alert(1)');
  assert.deepEqual(result.links, ['https://www.instagram.com/reel/TEST_1/', 'https://www.instagram.com/reel/TEST_2/']);
  assert.equal(result.duplicate_count, 1);
  assert.deepEqual(result.invalid_lines, [5]);
  ['https://instagram.com.evil.test/reel/A/', 'https://evil.test/?instagram.com/reel/A/', 'https://user:pass@instagram.com/reel/A/', 'https://instagram.com/omanvilla/', 'data:text/html,x'].forEach(url => assert.equal(funnel.instagramUrl(url), null));
});

test('WhatsApp link copies a public source URL without sending and normalizes Omani phone forms', () => {
  const local = funnel.whatsappLink({ property_id: 'test-property', title: 'TEST عقار' }, '٧١٢٣٤٥٦٧', 'https://instagram.com/reel/TEST_1/?igsh=tracking');
  const full = funnel.whatsappLink({ property_id: 'test-property', title: 'TEST عقار' }, '+968 71234567', 'https://www.instagram.com/reel/TEST_1/');
  assert.equal(local, full);
  const url = new URL(local);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/96871234567');
  assert.match(url.searchParams.get('text'), /https:\/\/www\.instagram\.com\/reel\/TEST_1\//);
  assert.doesNotMatch(url.searchParams.get('text'), /property-code/);
  assert.equal(funnel.normalizePhone('00968 71234567'), '96871234567');
  assert.throws(() => funnel.normalizePhone('968+96871234567'));
});

test('property code fallback is explicit and does not invent an Instagram source', () => {
  const link = funnel.whatsappLink({ property_id: '11111111-1111-4111-8111-111111111111' }, '96871234567');
  const text = new URL(link).searchParams.get('text');
  assert.match(text, /\[property-code:11111111-1111-4111-8111-111111111111\]/);
  assert.doesNotMatch(text, /Instagram|إنستغرام|instagram/);
  assert.throws(() => funnel.whatsappLink({ property_code: 'bad]code\n' }, '96871234567'));
});
