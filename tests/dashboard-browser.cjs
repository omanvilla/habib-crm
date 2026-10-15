'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/dashboard');fs.mkdirSync(out,{recursive:true});
const periods=['month','quarter','halfyear','nine_months','year','all'];
const periodStarts={month:'2026-10-01',quarter:'2026-07-15',halfyear:'2026-04-15',nine_months:'2026-01-15',year:'2025-10-15',all:null};
async function verifyPerformanceCards(page,container,role){
 const cards=page.locator(container+' .ops-person');await cards.first().waitFor();
 assert.equal(await cards.count(),['muscat','barka'].includes(role)?1:2);
 const text=await page.locator(container).innerText();
 for(const label of ['عقارات أُضيفت خلال الفترة','يشمل الزيارات السابقة للفترة','عملاء استفسروا عن عقار','مستفسرون ردّت عليهم الموظفة','رسائل أرسلتها الموظفة','استفسارات عقارية جديدة'])assert(text.includes(label),'Missing metric explanation: '+label);
 assert(text.includes('بدون الآلية أو الفاشلة'),'Successful staff messages must explicitly exclude automation and failed sends');
 assert(!/تواصل بشري منسوب للشغل|رسائل واتساب صادرة من الفريق/.test(text));
 for(const [name,clients,replied,sent] of [['موظفة مسقط التجريبية',13,10,794],['موظفة بركاء التجريبية',20,18,1176]]){
  const card=cards.filter({has:page.locator('.ops-person-title strong',{hasText:name})});if(!await card.count())continue;
  for(const [label,value] of [['عملاء استفسروا عن عقار',clients],['مستفسرون ردّت عليهم الموظفة',replied],['رسائل أرسلتها الموظفة',sent]]){
   const metric=card.locator('.ops-metric').filter({has:page.locator('small',{hasText:label})});
   assert.equal((await metric.locator('strong').textContent()).replaceAll(',',''),String(value),name+': '+label);
  }
 }
}
async function verifyPerformancePeriods(page,buttons,container,role){
 const keys=await page.locator(buttons).evaluateAll(nodes=>nodes.map(n=>n.dataset.period||n.getAttribute('onclick')?.match(/setReportPeriod\('([^']+)'/)?.[1]));
 assert.deepEqual(keys,periods,'Expected six consistent period presets');
 for(let i=0;i<periods.length;i++){
  const kind=periods[i],before=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').length);
  await page.locator(buttons).nth(i).click();
  await page.waitForFunction(count=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').length>count,before);
  await verifyPerformanceCards(page,container,role);
  const args=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1).args);
  assert.equal(args.p_from,periodStarts[kind],kind+' start must follow Oman date/calendar arithmetic');
  assert.equal(args.p_to,kind==='month'?'2026-11-01':'2026-10-16',kind+' exclusive upper boundary');
  const caption=await page.locator(container+' .ops-performance-caption').innerText();
  assert(caption.includes(kind==='month'?'31/10/2026':'15/10/2026'),'Inclusive period end should be shown');
  if(kind==='year')assert(caption.includes('15/10/2025'));
 }
}
(async()=>{
 await new Promise(r=>server.listen(4187,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,realEmployeeSessions:false,checks:[],errors:[]};
 try{
 for(const role of ['owner','muscat','barka','manager','viewer']){
  const context=await browser.newContext({viewport:{width:1440,height:1080},timezoneId:'America/Los_Angeles'}),page=await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-15T16:04:02Z'));
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
   await verifyPerformancePeriods(page,'#opsPerformanceDetails [data-period]','#opsDashboardPerformanceResults',role);
   await page.locator('#opsPerformanceDetails [data-period="month"]').click();await verifyPerformanceCards(page,'#opsDashboardPerformanceResults',role);
   if(role==='owner')await page.screenshot({path:path.join(out,'owner-performance.png'),fullPage:true,animations:'disabled'});
   await page.locator('#opsPerformanceDetails > summary').click();
  }
  if(role==='owner'){
   await page.evaluate(()=>navigate('team',null));
   await page.locator('#employeePerformanceResults .ops-person').first().waitFor();
   await verifyPerformancePeriods(page,'#employeePerformancePanel [data-period]','#employeePerformanceResults',role);
   await page.screenshot({path:path.join(out,'owner-team-performance.png'),fullPage:true,animations:'disabled'});
   await page.evaluate(()=>navigate('reports',null));await page.locator('#repTeamTab').click();
   await page.locator('#teamLeaderboard .ops-person').first().waitFor();
   await verifyPerformancePeriods(page,'#page-reports .period-selector .period-btn','#teamLeaderboard',role);
   await page.locator('#reportMonthPicker').fill('2024-02');await page.locator('#reportMonthPicker').dispatchEvent('change');
   await page.waitForFunction(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1)?.args.p_from==='2024-02-01');
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1).args.p_to),'2024-03-01');
   await page.locator('#page-reports .period-selector .period-btn').nth(4).click();
   await page.waitForFunction(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1)?.args.p_from==='2025-10-15');
   assert.equal(await page.locator('#reportMonthPicker').inputValue(),'','A preset must clear the old specific-month override');
   await verifyPerformanceCards(page,'#teamLeaderboard',role);
   await page.screenshot({path:path.join(out,'owner-report-team-performance.png'),fullPage:true,animations:'disabled'});
   report.checks.push('owner: shared performance metrics and six matching Oman-local periods in dashboard, Team and Reports Team; rolling year; inclusive date captions; leap-February custom month and stale override reset');
   await page.evaluate(()=>navigate('dash',null));
  }
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const r=document.querySelector('#page-dash').getBoundingClientRect();return document.body.classList.contains('crm-mobile')&&r.left>=0&&r.right<=innerWidth;});await page.screenshot({path:path.join(out,role+'-mobile.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' viewport overflow');
  assert.equal(await page.locator('#page-dash').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,role+' mobile overflow');
  assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(await page.locator('#page-dash').innerText()));
  if(role!=='viewer'){
   await page.locator('#opsPerformanceDetails > summary').click();await verifyPerformanceCards(page,'#opsDashboardPerformanceResults',role);
   assert.equal(await page.locator('#opsPerformanceDetails').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,role+' performance mobile overflow');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' performance viewport overflow');
   await page.screenshot({path:path.join(out,role+'-performance-mobile.png'),fullPage:true,animations:'disabled'});
  }
  report.checks.push(role+': professional heading, quick actions, scoped summaries/lists, no property reminder query, terminal states, desktop/mobile width, Western numbers'+(role==='owner'?', private-work split, partial-failure retry, scoped pagination and metric explanations':''));
  await context.close();
 }
 assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
