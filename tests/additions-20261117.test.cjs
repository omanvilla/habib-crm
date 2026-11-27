'use strict';
// 17 Nov 2026 (Ahmed: «سوّ الإضافات كلها» after the full system check): goals on the home, quick property, «اتصل بعدهم»,
// last visit, staff confirm meetings. SQL114.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const read=f=>fs.readFileSync(f,'utf8');
const index=read('index.html'),home=read('crm-owner-home.js'),calls=read('crm-calls-meetings.js'),quick=read('crm-quick-property.js');
const fwd=read('db/changes/114-call-next-last-seen.forward.sql'),back=read('db/changes/114-call-next-last-seen.rollback.sql');

test('index loads the quick property module right after the call module, versions moved on',()=>{
  assert(index.includes('<script src="crm-calls-meetings.js?v=20261127-hunt1"><\\/script><script src="crm-quick-property.js?v=20261117-goal1"><\\/script>'));
  assert(/crm-owner-home\.js\?v=202611(19|2\d)-/.test(index)&&/crm-owner-home\.css\?v=202611(1[89]|2\d)-/.test(index)&&index.includes('crm-calls-meetings.css?v=20261117-goal1'));
});

test('home goals come from the branch target snapshot; staff never get the commission chip',()=>{
  assert(home.includes("supa.rpc('crm_branch_target_snapshot')"));
  assert(home.includes('<section class="card coh-sec coh-goals" id="cohGoals" hidden></section>'));
  for(const label of ['زيارات تمت هالأسبوع','متابعات اليوم','عقارات جديدة هالأسبوع','حجوزات الشهر'])assert(home.includes(label),label);
  assert(home.includes("owner&&b.expected_commission!=null?chip('عمولة متوقعة الشهر'"));
  // 24 Nov: with two branches the month's deals and commission are drawn once for the company, the commission for the owner only
  assert(home.includes("(owner&&list.some(b=>b.expected_commission!=null)?chip('عمولة متوقعة الشهر',sum('expected_commission'),top('expected_commission'),true):'')"));
  // visits and bookings are not repeated in the week summary once the goals are drawn
  assert(home.includes("concat(goals?[]:[['زيارات تمت',r.visits_done],['حجوزات الشهر',r.bookings_month]])"));
});

test('quick property: few fields, owner found by the last 8 digits or added, same table and guards, branch sent',()=>{
  assert(quick.includes('window.crmQuickProperty=open;'));
  assert(quick.includes("const last8=v=>digits(v).slice(-8);"));
  assert(quick.includes("supa.from('owners').insert({company_id:cid,"));
  assert(quick.includes("const from=typeof crmDataFrom==='function'?crmDataFrom('properties'):supa.from('properties');"));
  assert(/branch_key:branch,source_type:source/.test(quick));
  assert(!/sourced_by/.test(quick.split('\n').filter(l=>!l.trim().startsWith('*')&&!l.trim().startsWith('/*')).join('\n')),'the source guard records staff by itself');
  assert(quick.includes("b.setAttribute('onclick','crmQuickProperty()')"));
  assert(quick.includes("openCreateModal('mProperty')"),'the full form stays one tap away');
  assert(!/owner_net|expected_commission/.test(quick),'no money fields');
});

test('the call window: «اتصل بعدهم», «سجّل العقار» after an owner who agreed, last visit for managers',()=>{
  assert(calls.includes('data-ccm="next-open">اتصل بعدهم'));
  assert(calls.includes("supa.rpc('crm_call_next',{p_limit:30})"));
  assert(calls.includes("if(kind==='owner'&&result==='agreed'&&typeof window.crmQuickProperty==='function')"));
  assert(calls.includes("window.crmQuickProperty({name:nm,phone:ph,source:'owner'})"));
  assert(calls.includes("supa.rpc('crm_mark_seen')"));
  assert(calls.includes("if(manages()&&callsToday&&(callsToday.people||[]).length)"));
  assert(calls.includes("+seenText(x.user_id)).join('<br>')"));
});

test('staff confirm a meeting from their own task (owner, manager, agent)',()=>{
  assert(calls.includes("!/^\\s*اجتماع/.test(String(task.title||''))||!staff()||!task.client_id)return;"));
});

test('SQL114 only adds two functions, with the offers page visibility and a 30-day call window',()=>{
  assert(fwd.includes('CREATE OR REPLACE FUNCTION public.crm_call_next(p_limit integer DEFAULT 20)'));
  assert(fwd.includes("NOT crm_repair_private.owner_line_is_private(ol.company_id, to_jsonb(ol))"));
  assert(fwd.includes('crm_repair_private.can_access_client(c, k.id)'));
  assert(fwd.includes("a.occurred_at > now() - interval '30 days'"));
  assert(fwd.includes("ol.status = 'open'"));
  assert(fwd.includes("last_login_at < now() - interval '5 minutes'"));
  assert(/REVOKE ALL ON FUNCTION public\.crm_call_next\(integer\) FROM PUBLIC, anon;/.test(fwd));
  assert(!/DROP|ALTER TABLE|DELETE FROM/i.test(fwd));
  assert(back.includes('DROP FUNCTION IF EXISTS public.crm_call_next(integer);')&&back.includes('DROP FUNCTION IF EXISTS public.crm_mark_seen();'));
  assert.equal(read('supabase/migrations/20261117130000_call_next_last_seen_20261117.sql'),fwd);
});
