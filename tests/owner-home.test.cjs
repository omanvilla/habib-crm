'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-owner-home.js','utf8'),css=fs.readFileSync('crm-owner-home.css','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/60-owner-home-visit-request-templates.forward.sql','utf8');

test('the page loads the owner home after the sections it reuses',()=>{
 assert(index.indexOf('crm-owner-home.js?v=')>index.indexOf('crm-owner-leads.js?v='));
 assert.match(index,/crm-owner-home\.css\?v=/);
});
// 9 Nov 2026 redesign: hello line, tiles for what needs the owner now, quick decisions, one summary (owner decision).
test('the home sections are there and the full work list stays reachable',()=>{
 for(const title of ['المطلوب منك الآن','مشاكل','ملخص','العقارات','متابعة اليوم','العقل موقوف عندهم'])assert(js.includes(title),title);
 assert(js.includes('قائمة العمل الكاملة'));
 assert.match(css,/coh-on:not\(\.coh-full-open\)>#opsDailyWork/);
});
test('staff keep their page and a failed load keeps the old page',()=>{
 assert.match(js,/if\(!isOwner\(\)[^;]*;page\.classList\.remove\('coh-on'\);(releaseGate\(\);)?return;\}/);
 assert.match(js,/if\(home\.error\|\|!home\.data\)\{if\(!last\)\{box\.hidden=true;page\.classList\.remove\('coh-on'\);\}return;\}/);
});
test('the old dashboard is never painted for the owner before the home (boot gate, 10 Nov 2026)',()=>{
 assert.match(css,/html\.coh-boot #page-dash:not\(\.coh-on\)>\*\{display:none!important\}/);
 assert.match(js,/if\(isOwner\(\)&&!last\)armGate\(\);else if\(!isOwner\(\)\)releaseGate\(\);/);
 assert.match(js,/timer:setTimeout\(releaseGate,8000\)/,'the gate never holds the page longer than 8 s');
 assert.match(js,/\}finally\{if\(seq===sequence\)releaseGate\(\);\}/,'the gate opens after the first load whatever its result');
 const ops=fs.readFileSync('crm-operations-v6.js','utf8');
 assert.equal((ops.match(/if\(window\.crmHomeFirst\)\{await window\.crmHomeFirst;/g)||[]).length,2,'old dashboard reads wait for the home');
});
test('visits without a result stay one tap away (owner decision 6 Nov: the AI records them)',()=>{
 assert(js.includes('زيارات يتابعها الذكاء الاصطناعي')&&js.includes('data-kind="visits"'));
 assert(js.includes('data-cqv="result"')&&js.includes('زيارة ما كانت مسجّلة'));
 assert(sql.includes("'auto_visits', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND v.created_via = 'whatsapp_ai')"));
});
test('the owner-offers tile opens the page on what it counted (10 Nov 2026)',()=>{
 const leads=fs.readFileSync('crm-owner-leads.js','utf8');
 assert(js.includes("nav==='owner-leads'&&b.classList.contains('coh-tile')&&typeof window.crmOwnerLeadsShowWeek==='function'"));
 assert.match(leads,/state\.status==='week'\?x\.status==='open'&&Date\.parse\(x\.created_at\)>weekAgo/);
});
test('the home data is owner only',()=>{
 assert(sql.includes("IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'"));
 assert(sql.includes('REVOKE ALL ON FUNCTION public.crm_owner_home() FROM PUBLIC, anon;'));
});
test('the manual visit form still asks which request; only automatic visits pick one',()=>{
 assert(sql.includes("new.created_via NOT IN ('whatsapp_ai','system')"));
});
test('follow-up wording changes only after Meta approves it as UTILITY',()=>{
 assert(sql.includes("upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY'"));
 for(const line of sql.split('\n').filter(l=>/WHEN p_step = [234] THEN '/.test(l))){
  const text=line.match(/'(.*)'/)[1];
  assert(!/[،,.!]/.test(text),text);assert(text.endsWith(' ؟'),text);
 }
});
