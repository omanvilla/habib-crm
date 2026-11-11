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
