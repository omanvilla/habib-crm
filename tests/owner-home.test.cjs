'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-owner-home.js','utf8'),css=fs.readFileSync('crm-owner-home.css','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/60-owner-home-visit-request-templates.forward.sql','utf8');

test('the page loads the owner home after the sections it reuses',()=>{
 assert(index.indexOf('crm-owner-home.js?v=')>index.indexOf('crm-owner-leads.js?v='));
 assert.match(index,/crm-owner-home\.css\?v=/);
});
test('the four sections are there and the full work list stays reachable',()=>{
 for(const title of ['يحتاج قرارك','مشاكل','العقارات','تقرير قصير'])assert(js.includes(title),title);
 assert(js.includes('قائمة العمل الكاملة'));
 assert.match(css,/coh-on:not\(\.coh-full-open\)>#opsDailyWork/);
});
test('staff keep their page and a failed load keeps the old page',()=>{
 assert.match(js,/if\(!isOwner\(\)[^;]*;page\.classList\.remove\('coh-on'\);return;\}/);
 assert.match(js,/if\(home\.error\|\|!home\.data\)\{if\(!last\)\{box\.hidden=true;page\.classList\.remove\('coh-on'\);\}return;\}/);
});
test('upcoming visits leave only after the first visit logged by itself; visits without a result always stay',()=>{
 assert(js.includes("Number(d.auto_visits)>0?[]:(d.upcoming||[])"));
 assert(js.includes('زيارات تحتاج نتيجة'));
 assert(sql.includes("'auto_visits', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND v.created_via = 'whatsapp_ai')"));
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
