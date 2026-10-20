'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/dashboard');fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4187,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,realEmployeeSessions:false,checks:[],errors:[]};
 try{
 for(const role of ['owner','muscat','barka','manager','viewer']){
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>report.errors.push(role+': '+e.message));
  await page.goto('http://127.0.0.1:4187/after/'+role+'/');await page.waitForFunction(()=>document.querySelector('[data-dashboard-card="branches"][aria-busy="false"]')&&document.querySelector('#opsScopeWork .ops-work-section'));
  await page.locator('#loaderScreen').waitFor({state:'hidden'});
  assert.equal(await page.locator('#opsDashboardTitle').textContent(),role==='owner'?'لوحة الإدارة':'لوحة العمل');assert(!/مرحباً|ماذا يحتاج شغلك/.test(await page.locator('#page-dash').innerText()));
  assert.equal(await page.locator('.dash-toolbar .qa-btn').count(),4);assert.equal(await page.locator('#dashPropertyActionQueue').isVisible(),false);
  assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_property_action_queue').length),0);
  const branches=await page.locator('[data-dashboard-card="branches"]').innerText();assert.match(branches,/متابعة|مستحقة/);assert(!branches.includes('المستثمر الخاص الاصطناعي')); 
  if(role==='owner'){
   assert.equal(await page.locator('[data-dashboard-card="investment"]').count(),1);
   assert(!(await page.locator('#opsScopeWork').innerText()).includes('المستثمر الخاص الاصطناعي'));
   await page.locator('[data-dashboard-card="investment"] [data-dashboard-category="contact"]').click();assert((await page.locator('#opsScopeWork').innerText()).includes('المستثمر الخاص الاصطناعي'));assert(!(await page.locator('#opsScopeWork').innerText()).includes('عميل مسقط التجريبي'));
   await page.locator('.ops-scope-tabs [data-dashboard-scope="branches"]').click();
   assert((await page.locator('#opsScopeWork').innerText()).includes('عميل مسقط التجريبي'));assert((await page.locator('#opsScopeWork').innerText()).includes('عميل متابعة بركاء'));
   await page.screenshot({path:path.join(out,'owner-desktop.png'),fullPage:true,animations:'disabled'});
   // A failed branch source does not erase the successful private scope.
   await page.evaluate(()=>{CRMPREVIEW.failNext='crm_dashboard_work';return loadDashboard();});
   assert(await page.locator('[data-dashboard-card="branches"] [role="alert"]').isVisible());assert(!(await page.locator('[data-dashboard-card="investment"]').innerText()).includes('تعذر'));
   await page.locator('[data-dashboard-card="branches"] [data-dashboard-retry]').click();await page.waitForFunction(()=>!document.querySelector('[data-dashboard-card="branches"] [role="alert"]'));
   // Create enough synthetic records to exercise first-page and scoped show-more behavior.
   await page.evaluate(()=>{const base=CRMPREVIEW.db.client_requests.find(r=>r.route_key==='muscat');for(let n=0;n<26;n++)CRMPREVIEW.db.client_requests.push({...base,id:'TEST-DASH-REQUEST-'+n,next_action:'TEST followup '+n});return loadDashboard();});
   await page.locator('[data-dashboard-card="branches"] [data-dashboard-category="followups"]').click();assert.match(await page.locator('#opsScopeWork').innerText(),/المعروض 20 من/);
   await page.locator('[data-dashboard-more="followups"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-list="followups"] .ops-work-row').length>20);assert.equal(await page.locator('[data-dashboard-list="followups"] .ops-work-row').count(),29);
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_dashboard_work'&&x.args.p_offset===20).at(-1).args.p_scope),'branches');
   await page.evaluate(()=>{CRMPREVIEW.db.client_requests=CRMPREVIEW.db.client_requests.filter(r=>!String(r.id).startsWith('TEST-DASH-REQUEST-'));return loadDashboard();});
  }else{
   assert.equal(await page.locator('[data-dashboard-card="investment"]').count(),0);assert(!(await page.locator('#opsDailyWork').innerText()).includes('المستثمر الخاص الاصطناعي'));
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_dashboard_work'&&x.args.p_scope==='investment').length),0);
   if(role==='muscat')assert(!(await page.locator('#opsScopeWork').innerText()).includes('عميل متابعة بركاء'));
   if(role==='barka')assert(!(await page.locator('#opsScopeWork').innerText()).includes('عميل مسقط التجريبي'));
   await page.screenshot({path:path.join(out,role+'-desktop.png'),fullPage:true,animations:'disabled'});
  }
  if(role!=='viewer'){
   await page.locator('#opsPerformanceDetails > summary').click();await page.waitForFunction(()=>document.querySelector('#opsDashboardPerformanceResults .ops-person'));
   const text=await page.locator('#opsDashboardPerformanceResults').innerText();assert.match(text,/عقارات أُضيفت خلال الفترة/);assert.match(text,/يشمل الزيارات السابقة للفترة/);assert.match(text,/رسائل أرسلها الفريق/);assert.doesNotMatch(text,/رسائل واتساب صادرة من الفريق/);assert(!text.includes('تواصل بشري منسوب للشغل'));
   for(const explanation of ['كل عميل مرة واحدة خلال الفترة','رد بشري بعد الاستفسار وفي الفترة نفسها','رسائل أُرسلت بنجاح؛ بدون الآلية أو الفاشلة'])assert(text.includes(explanation),explanation);
   await page.locator('#opsDashboardPerformanceResults .ops-metric-definitions > summary').click();
   assert.match(await page.locator('#opsDashboardPerformanceResults .ops-metric-definitions').innerText(),/تُستبعد الآلية والفاشلة والمعلقة/);
   const counts=await page.locator('#opsDashboardPerformanceResults .ops-person').evaluateAll(cards=>cards.map(card=>{
    const value=key=>Number(card.querySelector('[data-performance-metric="'+key+'"] .ops-performance-value')?.textContent);
    return {name:card.querySelector('.ops-person-title strong').textContent,inquiries:value('inquiry_clients'),replied:value('replied_inquiry_clients'),messages:value('successful_staff_messages')};
   }));
   // The branch RPC orders by branch key (barka, muscat), independently of account creation order.
   const expected=[{name:'بركاء',inquiries:2,replied:1,messages:5},{name:'مسقط',inquiries:4,replied:3,messages:7}];
   assert.deepEqual(counts,role==='muscat'?[expected[1]]:role==='barka'?[expected[0]]:expected,role+' metric counts and branch scope');
   if(role==='owner')await page.screenshot({path:path.join(out,'owner-performance.png'),fullPage:true,animations:'disabled'});
   await page.locator('#opsPerformanceDetails > summary').click();
  }
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const r=document.querySelector('#page-dash').getBoundingClientRect();return document.body.classList.contains('crm-mobile')&&r.left>=0&&r.right<=innerWidth;});await page.screenshot({path:path.join(out,role+'-mobile.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' viewport overflow');
  assert.equal(await page.locator('#page-dash').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,role+' mobile overflow');
  assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(await page.locator('#page-dash').innerText()));
  report.checks.push(role+': professional heading, quick actions, scoped summaries/lists, no property reminder query, terminal states, desktop/mobile width, Western numbers'+(role==='owner'?', private-work split, partial-failure retry, scoped pagination and metric explanations':''));
  await context.close();
 }
 assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
