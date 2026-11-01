'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-quick-visit.js','utf8'),index=fs.readFileSync('index.html','utf8'),simple=fs.readFileSync('crm-simple-ui.js','utf8');

test('loader includes the quick visit module after the simplification module',()=>{
  assert.match(index,/crm-quick-visit\.css\?v=/);
  assert(index.indexOf('crm-quick-visit.js?v=')>index.indexOf('crm-simple-ui.js?v='));
});

test('quick results save through the same atomic visit RPC as the full form',()=>{
  assert.match(js,/supa\.rpc\('crm_save_viewing_atomic',\{p_payload:data,p_idempotency_key:crmSaveKey\('mQuickVisit',data\)\}\)/);
  assert(!/from\('viewings'\)\.(insert|update)/.test(js),'no direct table writes');
  assert(!/from\('deals'\)/.test(js),'deal stages move only through the visit rules');
  assert.match(js,/data\.expected_version=s\.version/,'edits carry the row version');
});

test('each opinion maps to an allowed outcome and "did not suit" requires a reason',()=>{
  for(const [feedback,outcome] of [['liked','followup'],['wants_negotiate','negotiation'],['hesitant','followup'],['disliked','lost']])
    assert(new RegExp("feedback:'"+feedback+"',outcome:'"+outcome+"'").test(js),feedback);
  assert.match(js,/if\(op&&op\.outcome==='lost'&&!s\.reason\)throw new Error\('اختر السبب الرئيسي'\)/);
  assert.match(js,/if\(done&&!op\)throw new Error\('اختر رأي العميل'\)/);
});

test('customer and property text is escaped in the card and the sheet',()=>{
  assert.match(js,/esc\(v\.property&&v\.property\.title/);assert.match(js,/esc\(v\.client&&v\.client\.name/);
  assert.match(js,/esc\(c\.name\)/);assert.match(js,/esc\(p\.title\)/);
});

test('visits table offers the quick result for today and overdue scheduled visits',()=>{
  assert.match(simple,/v\.status==='scheduled'&&\(v\.viewing_date\|\|''\)<=today\?.*\(window\.crmQuickVisit\|\|editViewing\)/);
});
