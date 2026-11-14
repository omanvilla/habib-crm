'use strict';
// SQL92 (11 Nov 2026, Ahmed): price study reports go one client at a time, in order, 2+ minutes apart, parts paced.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fn=fs.readFileSync('supabase/functions/whatsapp-owner-hot-alert/index.ts','utf8');
const fwd=fs.readFileSync('db/changes/92-price-study-queue.forward.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261112110000_price_study_queue_20261111.sql','utf8');
test('reports are queued and sent by a tick with a 2-minute gap',()=>{
  assert(fn.includes('const GAP_MS = 2 * 60 * 1000;'));
  assert(fn.includes('async function priceStudyTick()'));
  assert(fn.includes('if (now - lastAt < GAP_MS) return { waiting: "gap"'));
  assert(fn.includes('out.push(await enqueuePriceStudy(rows[i].id, counts[rk], totals[rk]'),'numbered per branch');
  assert(fn.includes('const rows = ["barka", "muscat"].flatMap('),'Barka first, then Muscat');
  assert(fn.includes('if (body?.action === "price_study_tick")'));
  assert(!fn.includes('out.push(await priceStudy(rows[i].id'));
});
test('the parts of one client are paced so WhatsApp keeps their order',()=>{
  assert(fn.includes('if (r.id) await pause(m.message_type === "image" ? 2500 : 6000);'));
});
test('SQL92 schedules the tick every minute and is mirrored',()=>{
  assert.equal(fwd,mirror);
  assert(fwd.includes("cron.schedule('owner_price_study_tick', '* * * * *'"));
  assert(fwd.includes('"action":"price_study_tick"'));
});
// R57 (Ahmed 14 Nov 2026): pricing is automatic, so the report of a NEW study no longer goes to his WhatsApp. The message
// he gets is the ready one from price-study.
test('R57: the report of a new study is not queued any more; the ready message is the one Ahmed gets',()=>{
 assert(fn.includes('const PRICE_STUDY_REPORT = false;'));
 const a=fn.indexOf('async function enqueuePriceStudy(');assert(a>=0);
 assert(fn.slice(a,a+260).includes('if (!PRICE_STUDY_REPORT) return { conversation_id: convId, skipped: "report_off" };'),'before any read or insert');
 assert(fs.readFileSync('supabase/functions/price-study/index.ts','utf8').includes('📊 دراسة سعر جاهزة لموافقتك'));
});
