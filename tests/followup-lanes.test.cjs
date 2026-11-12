'use strict';
// SQL91 / R35 (12 Nov 2026): investors and Muscat properties are separate follow-up lanes; the list shows what really goes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fwd=fs.readFileSync('db/changes/91-followup-lanes.forward.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261112100000_followup_lanes_20261112.sql','utf8');
const js=fs.readFileSync('crm-followups-today.js','utf8');
const fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8');
test('SQL91 is guarded, mirrored, and adds lane + sends_text',()=>{
  assert.equal(fwd,mirror);
  assert(fwd.includes('SQL91 ('));
  assert(fwd.includes("'d9f0f7ca93fa33025bbedfe3c0b5a8f7'"));
  assert(fwd.includes('AS lane,'));
  assert(fwd.includes("'بخصوص طلبك ' || coalesce(q.template_params ->> 0, '') || E'\\nلين الحين تبحث ؟'"));
  assert(fwd.includes("THEN 'investor' ELSE 'muscat' END"));
});
test('the follow-ups screen has an investors tab and shows what reaches the client',()=>{
  assert(js.includes("['investor','المستثمرين']"));
  assert(js.includes("const laneOf=i=>i.lane||i.route_key"));
  assert(js.includes('اللي بيوصل للعميل من النظام'));
});
test('R35: investors are followed up, not skipped; subject fills the template; R34 no photos',()=>{
  assert(!fn.includes('skip (تنتقل لمتابعة المستثمرين'));
  assert(fn.includes('R35، أحمد 12 نوفمبر'));
  assert(fn.includes('subject: { type: ["string", "null"] }'));
  assert(fn.includes('required: ["decision", "reason", "text", "auto_ok", "request", "subject", "stage", "offer_no"]'));
  assert(fn.includes('.eq("template_name", "request_followup_ar_v2")'));
  assert(fn.includes('لا تعد بصور أبداً ولا تسأل "أرسل لك الصور ؟"'));
});
