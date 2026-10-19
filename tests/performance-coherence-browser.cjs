'use strict';
// Presentation/SDK contract checks with only synthetic records. Production RLS,
// actual authentication and SQL metric correctness are separate evidence.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/performance-coherence');fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],roles:[]};
const metric=(scope,key)=>scope.locator('[data-performance-metric="'+key+'"] .ops-performance-value');
async function expectMetrics(card,values){for(const [key,value] of Object.entries(values))assert.equal(await metric(card,key).innerText(),value,key);}
(async()=>{
 await new Promise(resolve=>server.listen(4196,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  for(const role of ['barka','muscat','owner','manager']){
   const context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();report.externalRequests.push(new URL(route.request().url()).origin);return route.abort();});
   page.on('pageerror',e=>report.errors.push(role+': '+e.message));await page.clock.install({time:new Date('2026-10-19T08:00:00Z')});
   await page.goto('http://127.0.0.1:4196/after/'+role+'/');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();await page.locator('#instantLoader').waitFor({state:'hidden'});
   await page.evaluate(()=>{
    const original=supa.rpc;window.coherenceMode='base';
    supa.rpc=async function(name,args){
     if(name==='crm_employee_performance'&&window.coherenceMode==='error')return {data:null,error:{message:'SYNTHETIC PERFORMANCE UNAVAILABLE'}};
     const result=await original.call(this,name,args);
     if(name!=='crm_employee_performance'||result.error)return result;
     result.data.employees.forEach(x=>{
      Object.assign(x,{active_inventory:98765,inquiry_clients:13,inquiries:277,inquiry_property_pairs:16,replied_inquiry_clients:13,inquiry_to_visit:44,inquiry_pair_to_visit:1,successful_staff_messages:864,new_properties:2,
       visits_booked:93,visits_done:8,visit_cohort_total:5,visit_cohort_done:4,visit_cohort_pending:1,visit_cohort_cancelled:0,
       reservations:2,active_reservations:1,cancelled_reservations:1,sales:1,visit_to_sale:1,activities:99,followup_clients:window.coherenceFollowups??6,sales_without_reservation:1,
       expected_commission:4500,company_commission:2500,commission_collected:500.005,unknown_expected_commission:0,targets:{reservations_target:2,booking_commission_target:4000}});
      if(CRMPREVIEW.actor==='manager')Object.assign(x,{expected_commission:null,company_commission:null,commission_collected:null});
      if(window.coherenceMode==='legacy')for(const key of ['inquiry_property_pairs','inquiry_pair_to_visit','visit_cohort_total','visit_cohort_done','visit_cohort_pending','visit_cohort_cancelled','followup_clients'])delete x[key];
     });return result;
    };
   });
   await page.locator('#opsPerformanceDetails > summary').click();const panel=page.locator('#opsDashboardPerformanceResults');await panel.locator('.ops-performance-person').first().waitFor();
   assert.equal(await panel.locator('.ops-performance-person').count(),['owner','manager'].includes(role)?2:1);
   const card=panel.locator('.ops-performance-person').first(),inquiries=card.locator('[data-performance-stage="inquiries"]');
   await expectMetrics(inquiries,{inquiry_clients:'13',inquiry_property_pairs:'16',replied_inquiry_clients:'13',inquiry_pair_to_visit:'1'});
   assert.equal(await card.locator('.ops-performance-stage').count(),3);assert.equal(await card.locator('.ops-metrics .ops-metric').count(),0);
   await expectMetrics(card,{successful_staff_messages:'864',new_properties:'2',followup_clients:'6'});
   assert.doesNotMatch(await card.innerText(),/98,765|عقارات نشطة الآن|أنشطة متابعة موثقة/);assert.match(await page.locator('#opsEmployeeTargets').innerText(),/المخزون المتاح حاليًا/);
   checks.push('three related stage sections share inquiry client/property/reply values without additive duplicate tiles','manual messages, period additions and documented follow-up clients stay distinct; inventory remains in goals');
   await expectMetrics(card.locator('[data-performance-stage="visits"]'),{visit_cohort_total:'5',visit_cohort_done:'4',visit_cohort_pending:'1',visit_cohort_cancelled:'0'});
   await expectMetrics(card,{reservations:'2',active_reservations:'1',cancelled_reservations:'1',sales:'1',visit_to_sale:'1'});
   assert.match(await card.locator('.ops-performance-diagnostic').innerText(),/1 من مبيعات الفترة تفتقد تاريخ حجز/);
   checks.push('five appointment-date visits partition into four done/one incomplete/zero cancelled despite mismatched legacy counts','booking active/cancelled details and closed/visit-linked sales preserve separate dates and unknown-booking diagnostic');
   if(role==='manager'){assert.equal(await card.locator('.ops-performance-finance').count(),0);checks.push('manager financial-null contract is not reconstructed or displayed');}
   else{await expectMetrics(card,{expected_commission:'4,500',company_commission:'2,500',commission_collected:'500.005'});assert.match(await card.locator('.ops-performance-finance').innerText(),/بتاريخ التحصيل الفعلي/);checks.push('booking values, sale commission and actual partial receipt remain separate with milli-OMR precision');}
   assert.match(await panel.locator('.ops-performance-caption').innerText(),/2026-10-01.*2026-10-31.*بتوقيت مسقط/);
   if(role==='owner')await card.screenshot({path:path.join(out,'owner-period-desktop.png'),animations:'disabled'});
   await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' page width');assert.equal(await card.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,role+' performance width');
   assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(await card.innerText()));await card.screenshot({path:path.join(out,role+'-period-mobile.png'),animations:'disabled'});await page.setViewportSize({width:1440,height:1050});
   checks.push('explicit Oman-local month bounds and Western numerals; grouped result fits390px');
   await page.evaluate(()=>{window.coherenceMode='legacy';crmDashboardPerformancePeriod('month')});await page.waitForFunction(()=>document.querySelector('#opsDashboardPerformanceResults [data-performance-metric="visit_cohort_total"] .ops-performance-value')?.textContent==='—');
   for(const key of ['inquiry_property_pairs','inquiry_pair_to_visit','visit_cohort_total','visit_cohort_done','visit_cohort_pending','visit_cohort_cancelled','followup_clients'])assert.equal(await metric(panel.locator('.ops-performance-person').first(),key).innerText(),'—');
   assert.match(await panel.innerText(),/غير متاحة حاليًا/);checks.push('missing new cohort response shows unavailable, never legacy-counter subtraction or a fake zero');
   await page.evaluate(()=>{window.coherenceMode='error';crmDashboardPerformancePeriod('months3')});await panel.locator('[role="alert"]').waitFor();assert.equal(await panel.locator('.ops-performance-person').count(),0);
   await page.evaluate(()=>window.coherenceMode='base');await panel.locator('[data-performance-retry]').click();await panel.locator('.ops-performance-person').first().waitFor();assert.match(await panel.locator('.ops-performance-caption').innerText(),/2026-07-19.*2026-10-19/);
   assert.match(await panel.locator('.ops-person-title').first().innerText(),/لا تُقارن بهدف شهر واحد/);checks.push('failed request clears earlier results and retry retains the selected rolling period');
   const beforeRefresh=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').length);
   await page.evaluate(async()=>{window.coherenceFollowups=7;await loadDashboard();});
   await expectMetrics(panel.locator('.ops-performance-person').first(),{followup_clients:'7'});assert.match(await panel.locator('.ops-performance-caption').innerText(),/2026-07-19.*2026-10-19/);
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').length),beforeRefresh+1);
   await page.evaluate(()=>window.coherenceFollowups=6);checks.push('workspace refresh updates an open performance result once while retaining the selected rolling period');
   if(role==='owner'){
    await page.evaluate(()=>navigate('team',null));await page.locator('#employeePerformanceResults .ops-performance-person').first().waitFor();await expectMetrics(page.locator('#employeePerformanceResults .ops-performance-person').first(),{inquiry_clients:'13',visit_cohort_total:'5',followup_clients:'6'});
    await page.evaluate(()=>navigate('reports',null));await page.locator('#repTeamTab').click();await page.locator('#reportMonthPicker').fill('2024-02');await page.locator('#reportMonthPicker').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#teamLeaderboard .ops-performance-caption')?.textContent.includes('2024-02-29'));await expectMetrics(page.locator('#teamLeaderboard .ops-performance-person').first(),{inquiry_clients:'13',visit_cohort_total:'5',followup_clients:'6',expected_commission:'4,500',commission_collected:'500.005'});
    const args=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1).args);assert.deepEqual(args,{p_from:'2024-02-01',p_to:'2024-03-01'});
    checks.push('Team and Reports reuse the same presentation/response including an explicit historical leap-month filter');
    await page.locator('#repFunnelTab').click();const journey=page.locator('#conversionFunnel');await journey.locator('.ops-performance-person').first().waitFor();
    assert.equal(await journey.locator('.ops-performance-person').count(),2);assert.equal(await journey.locator('.ops-performance-stage').count(),6);assert.equal(await journey.locator('.ops-performance-finance,.ops-performance-work,.funnel-rate').count(),0);
    await expectMetrics(journey.locator('.ops-performance-person').first(),{inquiry_clients:'13',inquiry_property_pairs:'16',inquiry_pair_to_visit:'1',visit_cohort_total:'5',visit_cohort_done:'4',reservations:'2',sales:'1'});
    assert.match(await journey.locator('.ops-performance-caption').innerText(),/2024-02-01.*2024-02-29/);assert.match(await page.locator('#reportDataNotice').innerText(),/بيانات المستثمرين الخاصة غير مشمولة/);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await journey.locator('.ops-performance-person').first().screenshot({path:path.join(out,'owner-report-journey-mobile.png'),animations:'disabled'});await page.setViewportSize({width:1440,height:1050});
    checks.push('report journey shows real per-employee stages from the same historical period with no proxy visit or fabricated conversion ratio and fits390px');
    await page.evaluate(async()=>{await loadClients();await viewClient(allClients[0].id);});await page.locator('#cdTabJourney .c360-metric').first().waitFor({state:'attached'});
    assert.equal(await page.evaluate(()=>window.client360Data?.client.id===viewingClient.id),true);assert.equal(await page.locator('#cdActivities [role="alert"],#cdTabInterests [role="alert"],#cdTabRequests [role="alert"]').count(),0);
    checks.push('integrated client360 and related panes render the selected synthetic client using the guarded production functions');
   }
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.checkCount=report.roles.reduce((sum,role)=>sum+role.checks.length,0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
