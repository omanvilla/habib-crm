'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-owner-home.js','utf8'),css=fs.readFileSync('crm-owner-home.css','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/60-owner-home-visit-request-templates.forward.sql','utf8');

test('the page loads the owner home after the sections it reuses',()=>{
 assert(index.indexOf('crm-owner-home.js?v=')>index.indexOf('crm-owner-leads.js?v='));
 assert.match(index,/crm-owner-home\.css\?v=/);
});
// 9 Nov 2026 redesign: hello line, tiles for what needs the owner now, quick decisions, one summary (owner decision).
test('the home sections are there; the old work list is never read or shown (19 Nov 2026)',()=>{
 for(const title of ['المطلوب منك الآن','مشاكل','ملخص','العقارات','متابعة اليوم','العقل موقوف عندهم'])assert(js.includes(title),title);
 assert(!js.includes('قائمة العمل الكاملة')&&!js.includes("act==='full'"),'no button back to the old work list');
 assert(css.includes(':is(#page-dash.coh-on,html.coh-home #page-dash)>:is(.ops-dashboard-intro,#opsEmployeeTargets,#opsDailyWork,#crmQuickVisits){display:none!important}'));
 assert(js.includes('window.crmHomeActive=()=>hasHome();'));
 const ops=fs.readFileSync('crm-operations-v6.js','utf8'),qv=fs.readFileSync('crm-quick-visit.js','utf8');
 const work=ops.slice(ops.indexOf('window.crmLoadDashboardWork=async function(){'));
 assert(work.indexOf("if(await window.crmOldDashSkip())return;")<work.indexOf('const scopes=owner?'),'crm_dashboard_work is not read for a home account');
 assert(ops.includes("window.crmOldDashSkip().then(skip=>{if(!skip)mountTargetDashboard();});"),'nor the old target card');
 assert(qv.includes("if(typeof window.crmOldDashSkip==='function'&&await window.crmOldDashSkip())return;"),'nor the hidden visits card');
 assert(ops.includes("return typeof window.crmHomeActive==='function'&&!!window.crmHomeActive();"),'with the home file missing the old page still reads');
});
// 11 Nov 2026 (Ahmed): staff get this same home too (crm_staff_home, tests/staff-home.test.cjs); an account with no role keeps the old page
test('an account without a home role keeps the old page; a home account never gets it back (19 Nov 2026)',()=>{
 assert(js.includes("root.classList.toggle('coh-home',on);"),'.coh-home follows the role');
 assert(css.includes('html.coh-home.coh-slow #page-dash:not(.coh-on)::before'));
 assert.match(js,/if\(!hasHome\(\)[^;]*;page\.classList\.remove\('coh-on'\);(releaseGate\(\);)?return;\}/);
 assert.match(js,/if\(home\.error\|\|!home\.data\)\{if\(!last\)\{box\.hidden=true;page\.classList\.remove\('coh-on'\);\}return;\}/);
});
test('the old dashboard is never painted for the owner before the home (boot gate, 10 Nov 2026)',()=>{
 assert(css.includes(':is(html.coh-boot,html.coh-home) #page-dash:not(.coh-on)>*{display:none!important}'));
 assert.match(js,/if\(hasHome\(\)&&!last\)armGate\(\);else if\(!hasHome\(\)\)releaseGate\(\);/);
 assert.match(js,/timer:setTimeout\(releaseGate,8000\)/,'the gate never holds the page longer than 8 s');
 assert.match(js,/\}finally\{if\(seq===sequence&&\(ok\|\|!retryLater\(\)\)\)releaseGate\(\);\}/,'the gate opens after the first load; a failed one is retried and the 8 s timer still opens it');
 const ops=fs.readFileSync('crm-operations-v6.js','utf8');
 assert.equal((ops.match(/if\(window\.crmHomeFirst\)\{await window\.crmHomeFirst;/g)||[]).length,2,'old dashboard reads wait for the home');
});
// 14 Nov 2026 (Ahmed, signed in as staff, saw the old dashboard): two causes, both held here.
test('a failed first load of the home is read again by itself until it loads (19 Nov 2026: never the old page)',()=>{
 const body=js.slice(js.indexOf('function retryLater(){'),js.indexOf('function render(){'));
 assert(body.includes('if(last||!hasHome())return false;'),'never after a success');
 assert(js.includes('ok=true;retries=0;clearTimeout(retryTimer);'),'a success stops the retries');
 // the retry logic itself, run as plain JS
 let last=null,retries=0,retryTimer=null,calls=[];const hasHome=()=>true,load=()=>Promise.resolve();const cls=new Set(),document={documentElement:{classList:{add:c=>cls.add(c)}}};
 const setTimeout=(f,ms)=>{calls.push(ms);return calls.length;},clearTimeout=()=>{};
 const retryLater=eval('('+body.slice(0,body.lastIndexOf('}')+1)+')');
 for(let i=0;i<12;i++)retryLater();
 assert.deepEqual(calls,[2000,4000,8000,15000,15000,15000,15000,15000,15000,15000,30000,30000]);
 assert(cls.has('coh-slow'),'the placeholder says the connection is slow');
 last={};assert.equal(retryLater(),false);
});
test('the app starting before the modules arrived still gets the home (empty cache after a publication)',()=>{
 assert(index.includes(`h=h.replace('<html lang="ar" dir="rtl">','<html lang="ar" dir="rtl" class="coh-boot">');`),'the old dashboard is hidden from the first paint');
 assert(fs.readFileSync('app-base-v15.html','utf8').includes('<html lang="ar" dir="rtl">'),'the tag index.html replaces is there');
 assert(js.includes("if(appOpen()){markHome();if(hasHome())armGate();else releaseGate();}"),'the gate gets its 8 s timer even when applyRoleVisibility ran before this file');
 const tail=index.slice(index.indexOf('window.APP_VERSION='));
 assert(tail.includes('if(a&&a.classList.contains("visible")&&typeof loadDashboard==="function")loadDashboard();'),'every wrapper of loadDashboard gets its first run');
 assert(tail.includes('if(!window.crmOwnerHomeRefresh)document.documentElement.classList.remove("coh-boot")'),'a missing home file never leaves the page blank');
 assert(index.indexOf('crm-visit-key.js?v=')<index.indexOf('window.APP_VERSION='),'that call is the last script');
 assert(!/<\/script>/.test(tail.split("document.open()")[0].replace(/<\\\/script>/g,'')),'closing tags stay escaped inside the boot text');
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
