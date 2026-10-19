'use strict';
// Synthetic SDK/UI fault checks. These are not real Supabase authentication,
// RLS, Storage, provider-delivery or production-write tests.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/audit-faults');
fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,realEmployeeSessions:false,productionWrites:0,externalRequests:[],errors:[],roles:[]};
async function bookingForm(page,picked){
 await page.evaluate(()=>openModal('mDeal'));await page.locator('#dealWorkflowForm').waitFor();
 await page.locator('#dwClientChoice').selectOption(picked.client);
 await page.locator('#dwPropertyChoice').selectOption(picked.property);
 await page.locator('#dwStage').selectOption('deposit');
 await page.locator('#dwPaidDate').fill('2024-10-31');await page.locator('#dwPaidAmount').fill('500.005');
}
(async()=>{
 await new Promise(r=>server.listen(4193,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  for(const role of ['barka','muscat','owner']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',route=>{
    if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();
    report.externalRequests.push(new URL(route.request().url()).origin);return route.abort();
   });
   page.on('pageerror',e=>report.errors.push(role+': '+e.message));
   await page.clock.install({time:new Date('2026-05-31T20:01:00Z')});
   await page.goto('http://127.0.0.1:4193/after/'+role+'/');
   await page.waitForFunction(()=>document.querySelector('#opsEmployeeTargets .ops-person'));
   const picked=await page.evaluate(()=>{
    const branch=CRMPREVIEW.actor==='barka'?'barka':'muscat',c=CRMPREVIEW.db.clients.find(c=>c.lead_route===branch);
    CRMPREVIEW.db.client_requests.push({id:'SYNTHETIC-SECOND-'+branch,company_id:c.company_id,client_id:c.id,assigned_to:c.assigned_to,branch_key:branch,route_key:branch,status:'active',request_type:'tenant',property_type:'apartment',preferred_area:'منطقة الطلب الثاني',budget_min:200,budget_max:350,next_action:'اتصال اصطناعي لتأكيد الطلب الثاني'});
    return {client:c.id,phone:c.phone,property:CRMPREVIEW.db.properties.find(p=>p.branch_key===branch).id};
   });
   await page.evaluate(()=>navigate('clients',null));await page.locator('.ops-client').first().waitFor();
   const local=picked.phone.slice(4),queries=[local,local.replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]),local.replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]),'+968 '+local.slice(0,4)+' '+local.slice(4),'00968-'+local];
   for(const query of queries){await page.locator('#csText').fill(query);assert.equal(await page.locator('.ops-client').count(),1,role+': '+query);}
   await page.evaluate(()=>clearClientSmartSearch());
   await page.locator('#csType').selectOption('apartment');await page.locator('#csArea').fill('منطقة الطلب الثاني');await page.locator('#csBudget').fill('300');
   assert.equal(await page.locator('.ops-client').count(),1);
   assert.match(await page.locator('.ops-client').innerText(),/اتصال اصطناعي لتأكيد الطلب الثاني/);
   await page.evaluate(()=>{window.auditExports=[];downloadCSV=function(name,headers,rows){window.auditExports.push({name,headers,rows:structuredClone(rows)})};exportClients()});
   assert.deepEqual(await page.evaluate(()=>window.auditExports[0].rows.map(row=>row[0])),await page.locator('.ops-client-head .ops-title').allTextContents());
   await page.locator('#csType').selectOption('villa');assert.equal(await page.locator('.ops-client').count(),0,'separate request facts must not mix');
   await page.evaluate(()=>exportClients());assert.equal(await page.evaluate(()=>window.auditExports.length),1,'empty search must not export the unfiltered list');
   await page.evaluate(()=>clearClientSmartSearch());
   if(role!=='owner'){
    await page.locator('#csText').fill('المستثمر الخاص');assert.equal(await page.locator('.ops-client').count(),0);
    await page.locator('#csText').fill(role==='barka'?'عميل مسقط':'عميل متابعة بركاء');assert.equal(await page.locator('.ops-client').count(),0);
   }
   checks.push('phone formats and digits find the same client','secondary request filters stay on one request','existing fixture branch/private search scope retained');
   await page.evaluate(()=>clearClientSmartSearch());
   if(role==='owner'){
    await page.evaluate(()=>{const c=CRMPREVIEW.db.clients.find(c=>c.lead_route==='muscat');for(let i=0;i<1205;i++)CRMPREVIEW.db.clients.push({...c,id:'SYNTHETIC-PAGINATION-'+i,name:'عميل صفحات '+i});return loadClients()});
    await page.locator('#csText').fill('عميل صفحات 1204');assert.equal(await page.locator('.ops-client').count(),1);checks.push('client search reaches records beyond 1200');
   }
   await page.evaluate(()=>{window.auditPendingClients=loadClients();exportClients()});
   assert.equal(await page.evaluate(()=>window.auditExports.length),1,'loading list cannot export stale rows');
   await page.evaluate(()=>window.auditPendingClients);
   await page.evaluate(()=>{CRMPREVIEW.failNext='clients';return loadClients()});
   await page.locator('#clientsList [role=alert]').waitFor();await page.evaluate(()=>exportClients());
   assert.equal(await page.evaluate(()=>window.auditExports.length),1,'failed list cannot export earlier data');
   await page.evaluate(()=>loadClients());
   await page.evaluate(()=>navigate('properties',null));await page.locator('.ops-property').first().waitFor();
   const property=await page.evaluate(()=>{const branch=CRMPREVIEW.actor==='muscat'?'muscat':'barka';const p=CRMPREVIEW.db.properties.find(p=>p.branch_key===branch&&p.status==='available');return {branch,area:p.area,title:p.title}});
   if(role==='owner')await page.locator('#opsPropertyBranch').selectOption(property.branch);
   await page.locator('#opsPropertyArea').selectOption(property.area);await page.locator('#opsPropertyStatus').selectOption('available');
   assert.equal(await page.locator('.ops-property').count(),1);await page.evaluate(()=>exportProperties());
   assert.deepEqual(await page.evaluate(()=>window.auditExports.at(-1).rows.map(row=>row[0])),await page.locator('.ops-property > .ops-title').allTextContents());
   await page.locator('#opsPropertySearch').fill('SYNTHETIC-NO-MATCH');await page.evaluate(()=>exportProperties());
   assert.equal(await page.evaluate(()=>window.auditExports.length),2,'empty property filter cannot export all properties');
   await page.evaluate(()=>{CRMPREVIEW.failNext='properties';return loadProperties()});await page.locator('#propertiesList [role=alert]').waitFor();await page.evaluate(()=>exportProperties());
   assert.equal(await page.evaluate(()=>window.auditExports.length),2,'failed property list cannot export prior rows');
   checks.push('client CSV matches visible search/request filters','property CSV matches branch/area/status filters','empty, loading and failed lists cannot export earlier/unfiltered rows');
   // Date period checks run in a browser whose local timezone is not Oman.
   const periods={month:['2026-06-01','2026-07-01'],months3:['2026-03-01','2026-06-02'],months6:['2025-12-01','2026-06-02'],months9:['2025-09-01','2026-06-02'],year:['2025-06-01','2026-06-02'],all:[null,'2026-06-02']};
   for(const [kind,[from,to]] of Object.entries(periods)){
    await page.evaluate(kind=>crmDashboardPerformancePeriod(kind),kind);
    await page.waitForFunction(()=>document.querySelector('#opsDashboardPerformanceResults .ops-performance-caption'));
    const call=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1));
    assert.deepEqual(call.args,{p_from:from,p_to:to},role+': '+kind);
   }
   await page.clock.setFixedTime(new Date('2026-05-31T19:59:00Z'));
   await page.evaluate(()=>crmDashboardPerformancePeriod('months3'));await page.waitForFunction(()=>document.querySelector('#opsDashboardPerformanceResults .ops-performance-caption'));
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1).args.p_from),'2026-02-28');
   await page.clock.setFixedTime(new Date('2026-05-31T20:01:00Z'));
   checks.push('six period bounds use Oman date across UTC midnight','May31 rolling quarter clamps to February28');
   // Inject bounded data failures independently of the production transport.
   await page.evaluate(()=>{
    window.auditBaseRpc=supa.rpc;window.auditMode='target-error';window.auditDealCalls=[];
    supa.rpc=async function(name,args){
     if(name==='crm_employee_target_snapshot'&&window.auditMode==='target-error')return{data:null,error:{message:'SYNTHETIC TARGET UNAVAILABLE'}};
     if(name==='crm_save_deal_workflow'&&window.auditMode==='deferred-deal'){
      window.auditDealCalls.push(structuredClone(args));return new Promise(resolve=>window.auditDealResolve=resolve);
     }
     const result=await window.auditBaseRpc.apply(this,arguments);
     if(name==='crm_employee_performance'&&window.auditMode==='report-fixture'){
      for(const employee of result.data.employees)Object.assign(employee,{inquiry_clients:4,replied_inquiry_clients:3,successful_staff_messages:7,reservations:2,active_reservations:2,cancelled_reservations:0,expected_commission:4500,commission_collected:500.005});
     }
     return result;
    };
    navigate('dash',null);
   });
   await page.locator('#opsEmployeeTargets [role=alert]').waitFor();
   assert.equal(await page.locator('#opsEmployeeTargets .ops-person').count(),0);
   await page.evaluate(()=>window.auditMode='');await page.locator('[data-target-retry]').click();
   await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();assert.equal(await page.locator('#opsEmployeeTargets .ops-person').count(),role==='owner'?2:1);
   checks.push('target load failure is explicit and retry restores scoped values');
   if(role==='owner'){
    await page.evaluate(()=>navigate('team',null));await page.locator('[data-employee-goal-save]').first().waitFor();
    const id=await page.locator('[data-employee-goal-save]').first().getAttribute('data-employee-goal-save');
    await page.locator('#etDaily_'+id).fill('13');
    await page.evaluate(()=>CRMPREVIEW.failNext='employee_monthly_targets');await page.locator('[data-employee-goal-save="'+id+'"]').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('تعذر حفظ الأهداف'));
    assert.equal(await page.locator('#etDaily_'+id).inputValue(),'13');assert.equal(await page.locator('[data-employee-goal-save="'+id+'"]').isDisabled(),false);
    await page.locator('[data-employee-goal-save="'+id+'"]').click();
    await page.waitForFunction(id=>CRMPREVIEW.db.employee_monthly_targets?.some(x=>x.employee_id===id&&x.daily_followups_target===13),id);
    await page.waitForFunction(id=>document.querySelector('#etDaily_'+id)?.value==='13',id);
    await page.evaluate(()=>navigate('dash',null));await page.waitForFunction(()=>document.querySelector('#opsEmployeeTargets').textContent.includes('13'));
    checks.push('failed target save preserves inputs and re-enables save','acknowledged goal persistence refreshes dashboard');
    await page.evaluate(()=>{window.auditMode='report-fixture';navigate('reports',null)});await page.locator('#repTeamTab').click();
    await page.locator('#teamLeaderboard .ops-person').first().waitFor();
    assert.deepEqual(await page.locator('[data-report-period]').evaluateAll(es=>es.map(e=>e.dataset.reportPeriod)),['month','quarter','halfyear','nine_months','year','all']);
    await page.locator('#reportMonthPicker').fill('2024-02');await page.locator('#reportMonthPicker').dispatchEvent('change');
    await page.waitForFunction(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1)?.args.p_from==='2024-02-01');
    await page.waitForFunction(()=>document.querySelector('#teamLeaderboard .ops-performance-caption')?.textContent.includes('2024-02-29'));
    const span=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1).args);
    assert.deepEqual(span,{p_from:'2024-02-01',p_to:'2024-03-01'});
    const team=await page.locator('#teamLeaderboard').innerText();
    for(const label of ['عملاء استفسروا عن عقار','مستفسرون ردّت عليهم الموظفة','رسائل أرسلتها الموظفة','حجوزات مؤكدة في الفترة','عمولات متوقعة من حجوزات الفترة','عمولات المكتب المحصلة فعليًا في الفترة','4,500','500.005'])assert(team.includes(label),label);
    await page.screenshot({path:path.join(out,'owner-report-team-desktop.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'owner report mobile width');
    await page.screenshot({path:path.join(out,'owner-report-team-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-report-period="quarter"]').click();await page.waitForFunction(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_employee_performance').at(-1)?.args.p_from==='2026-03-01');
    assert.equal(await page.locator('#reportMonthPicker').inputValue(),'');
    checks.push('Reports team uses shared performance source with selected month and leap-day end','report labels separate unique inquiries, human replies/messages, bookings, expected and collected money','six report presets reset the explicit month','Reports team fits desktop and390px');
    await page.evaluate(()=>window.auditMode='');
    await page.evaluate(picked=>{
     const original=CRMPREVIEW.db.deals[0],first='00000000-0000-4000-8000-000000001801',second='00000000-0000-4000-8000-000000001802';
     for(const [id,amount] of [[first,2000],[second,2500]])CRMPREVIEW.db.deals.push({...original,id,client_id:picked.client,property_id:picked.property,stage:'closed',entry_mode:'historical',closed_at:'2024-10-31T08:00:00Z',created_at:'2024-10-28T08:00:00Z',reservation_confirmed_at:'2024-10-28T08:00:00Z',expected_company_commission_at_reservation:amount,company_commission:amount,company_share:111.111,agent_share:100,commission_status:'pending',deal_value:60000});
     CRMPREVIEW.db.deal_commission_receipts=[{id:'SYNTHETIC-PARTIAL-RECEIPT',deal_id:first,received_on:'2024-11-02',amount:500.005}];
     CRMPREVIEW.db.expenses=[{id:'SYNTHETIC-NOV-EXPENSE',company_id:CRMPREVIEW.profile.company_id,user_id:CRMPREVIEW.profile.id,category:'other',description:'مصروف اصطناعي لفحص دقة المبلغ',amount:25.003,expense_date:'2024-11-03',archived:false}];
    },picked);
    await page.locator('.report-tab').filter({hasText:'العمولات'}).click();await page.locator('#reportMonthPicker').fill('2024-10');await page.locator('#reportMonthPicker').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#revNet').textContent==='4,500');
    assert.equal(await page.locator('#revReceived').innerText(),'0');assert.equal(await page.locator('#kpiClosed').innerText(),'2');
    await page.locator('#reportMonthPicker').fill('2024-11');await page.locator('#reportMonthPicker').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#revReceived').textContent==='500.005');
    assert.equal(await page.locator('#revNet').innerText(),'0');assert.equal(await page.locator('#kpiClosed').innerText(),'0');assert.equal(await page.locator('#revPending').innerText(),'3,999.995');
    assert.match(await page.locator('#reportDataNotice').innerText(),/2024-11-01.*2024-11-30/);
    await page.screenshot({path:path.join(out,'owner-november-receipts.png'),fullPage:true,animations:'disabled'});
    await page.evaluate(()=>{CRMPREVIEW.failNext='crm_commission_report';return loadReports()});
    assert.equal(await page.locator('#revReceived').innerText(),'—');assert.match(await page.locator('#reportDataNotice').innerText(),/تعذر تحميل التقرير/);
    await page.evaluate(()=>loadReports());assert.equal(await page.locator('#revReceived').innerText(),'500.005');
    await page.clock.setFixedTime(new Date('2024-11-15T08:00:00Z'));await page.evaluate(()=>navigate('expenses',null));
    await page.waitForFunction(()=>document.querySelector('#sumIncome').textContent==='500.005');
    assert.equal(await page.locator('#sumExpenses').innerText(),'25.003');assert.equal(await page.locator('#sumProfit').innerText(),'475.002');assert.equal(await page.locator('#sumPending').innerText(),'3,999.995');
    await page.evaluate(()=>{CRMPREVIEW.failNext='crm_commission_report';return loadExpenses()});assert.equal(await page.locator('#sumIncome').innerText(),'—');
    await page.evaluate(()=>loadExpenses());assert.equal(await page.locator('#sumIncome').innerText(),'500.005');
    await page.clock.setFixedTime(new Date('2026-05-31T20:01:00Z'));
    checks.push('October expected4500 and closing2 stay independent of November partial receipt500.005','current outstanding3999.995 retains milli-OMR precision','cash API failure shows unavailable and retry restores actuals','Expenses uses November receipt date and subtracts25.003 to475.002');
   }
   await bookingForm(page,picked);assert.equal(await page.locator('#dwConfirmPaid').isChecked(),true);assert.equal(await page.locator('#dwConfirmPaid').isDisabled(),true);
   assert.match(await page.locator('#dwPaidDeposit').innerText(),/لا يلزم رفع مستند/);
   await page.evaluate(()=>{window.auditMode='deferred-deal';saveDeal();saveDeal()});
   await page.waitForFunction(()=>window.auditDealCalls.length===1);assert.equal(await page.locator('#dwSave').isDisabled(),true);
   await page.evaluate(()=>window.auditDealResolve({data:null,error:{message:'SYNTHETIC CONNECTION LOST'}}));
   await page.waitForFunction(()=>document.querySelector('#dwError').textContent.includes('SYNTHETIC CONNECTION LOST'));
   assert.equal(await page.locator('#dwPaidAmount').inputValue(),'500.005');assert.equal(await page.locator('#dwSave').isDisabled(),false);
   await page.locator('#dwSave').click();await page.waitForFunction(()=>window.auditDealCalls.length===2);
   const retries=await page.evaluate(()=>window.auditDealCalls);assert.equal(retries[0].p_idempotency_key,retries[1].p_idempotency_key);assert.deepEqual(retries[0].p_payload,retries[1].p_payload);
   await page.evaluate(()=>window.auditDealResolve({data:{deal_id:'SYNTHETIC-ACKNOWLEDGED'},error:null}));await page.waitForFunction(()=>!document.querySelector('#mDeal.on'));
   checks.push('deposit confirms once without document','double save sends one request','network failure preserves three-decimal amount and same retry key','acknowledged response closes form');
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>navigate('dash',null));await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' dashboard width');
   await page.screenshot({path:path.join(out,role+'-dashboard.png'),fullPage:true,animations:'disabled'});
   await bookingForm(page,picked);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' modal width');
   await page.screenshot({path:path.join(out,role+'-booking.png'),fullPage:true,animations:'disabled'});
   await page.evaluate(()=>{window.auditMode='deferred-deal';window.auditToasts=[];const toast=showToast;showToast=function(){window.auditToasts.push([...arguments]);return toast.apply(this,arguments)};saveDeal()});
   await page.waitForFunction(()=>window.auditDealCalls.length===3);
   await page.evaluate(()=>{clearSessionUI();window.auditDealResolve({data:{deal_id:'SYNTHETIC-LATE'},error:null})});
   await page.waitForFunction(()=>!document.querySelector('#appScreen.visible'));
   assert.equal(await page.locator('#opsEmployeeTargets').textContent(),'');
   assert.equal(await page.locator('#employeeTargetsPanel').textContent(),'');
   assert.equal(await page.locator('#mDeal').textContent(),'');
   assert.deepEqual(await page.evaluate(()=>window.auditToasts),[]);
   checks.push('mobile dashboard and booking fit390px','clearing session removes target/editor caches and rejects late-save UI response');
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
