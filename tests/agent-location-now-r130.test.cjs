'use strict';
// R130 (Ahmed 28 Nov 2026, Sana 95505576): a client on his way, near, arrived or waiting for the location gets it at once and the
// visit is recorded at that time; «برسلك الموقع» never goes without the location (or a handoff that sends it later).
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs');
const idx = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/whatsapp-reply-agent/index.ts'), 'utf8');
const re = (name) => { const m = idx.match(new RegExp(`const ${name} = (\\/.+\\/[a-z]*);`)); assert.ok(m, name); return eval(m[1]); };
test('R130 words: on the way, arrived, waiting for the location', () => {
  const NOW = re('COMING_NOW');
  for (const s of ['بعد شويا نروح', 'احنا وصلنا رميس', 'انتظر اللوكيشن', 'في الطريق', 'انا قريب', 'وين اللوكيشن', 'الحين جايين']) assert.ok(NOW.test(s), s);
  for (const s of ['بكره العصر ان شاء الله', 'تمام', 'كم السعر', 'ابي شي قريب من المدرسة']) assert.ok(!NOW.test(s), s);
});
test('R130 promise words', () => {
  const P = re('PROMISED_LOC');
  for (const s of ['ان شاء الله برسلك الموقع', 'ان شاء الله برسلك موقع فيلا الرميس بـ64 الف', 'بنرسل لك اللوكيشن']) assert.ok(P.test(s), s);
  assert.ok(!P.test('متى يناسبك تزور ؟'));
});
test('R130 guard sends the location, records the visit now and alerts Ahmed when nobody opens the house', () => {
  assert.match(idx, /out\.guard_location_now = true/);
  assert.match(idx, /out\.action = c\.prop\.visit_method === "lockbox" \? "send_lockbox" : "send_location"/);
  assert.match(idx, /out\.coming_alert = true/);
  assert.match(idx, /event_key: `coming_now:\$\{conv\.id\}:\$\{prop\.id\}`/);
  assert.match(idx, /out\.guard_no_empty_promise = true/);
  // the visit is recorded at this time when a location goes (existing block)
  assert.match(idx, /vd === todayM \? nowM : "16:00"/);
});
