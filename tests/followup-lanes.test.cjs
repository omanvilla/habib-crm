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
// SQL105 / R65 (14 Nov 2026, note a4f6f4dc): a question about ownership for a foreigner belongs to the investors lane.
test('SQL105 adds foreign ownership to the investors lane, guarded and mirrored',()=>{
  const f5=fs.readFileSync('db/changes/105-followup-lane-foreign-ownership.forward.sql','utf8');
  const r5=fs.readFileSync('db/changes/105-followup-lane-foreign-ownership.rollback.sql','utf8');
  assert.equal(f5,fs.readFileSync('supabase/migrations/20261114180000_followup_lane_foreign_ownership_20261114.sql','utf8'));
  assert(f5.includes('SQL105 (')&&f5.includes("'71de97d313d9c8dd21efe767a7a78d12'"),'refuses a followup_lane changed since SQL91');
  const oldList="c_old constant text := 'تملك حر|التملك الحر|';";
  assert(f5.includes(oldList)&&r5.includes(oldList)&&fwd.includes('تملك حر|التملك الحر|إقامة'),'the SQL91 list is the one replaced');
  const m=f5.match(/c_new constant text := '([^']+)';/);assert(m);assert(r5.includes(m[0]),'the rollback takes out exactly what was added');
  // the added words, as the JS engine reads the same pattern (Postgres \s = JS \s here)
  const added=new RegExp(m[1].replace('تملك حر|التملك الحر|','').replace(/\|$/,''));
  for(const s of ['سأل عن تملك الأجنبي والمواقع','هلا بخصوص تملك لاجنبي','تملك الاجانب','شقة للأجانب','لغير العمانيين'])assert(added.test(s),s);
  for(const s of ['بيت الحيل الجنوبية','شقة في المعبيلة','متى يناسبك تزور'])assert(!added.test(s),s);
  assert(f5.includes('EXECUTE replace(v_def, c_old, c_new);')&&r5.includes('EXECUTE replace(v_def, c_new, c_old);'));
});
