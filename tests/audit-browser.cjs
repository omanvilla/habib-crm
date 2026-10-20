'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/audit');fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4191,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,realEmployeeSessions:false,productionWrites:0,errors:[],roles:[]};
 try{
 for(const role of ['barka','muscat','owner']){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>report.errors.push(role+': '+e.message));
  await page.goto('http://127.0.0.1:4191/after/'+role+'/');await page.locator('#page-dash').waitFor();await page.locator('#loaderScreen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#opsEmployeeTargets .ops-person'));
  assert.equal(await page.locator('#opsEmployeeTargets .ops-person').count(),role==='owner'?2:1);
  assert.match(await page.locator('#opsEmployeeTargets').innerText(),/0%/);
  const routeNames=await page.locator('.nav-link').evaluateAll(es=>es.filter(e=>e.offsetWidth&&e.offsetHeight).map(e=>(e.getAttribute('onclick')||'').match(/navigate\('([^']+)'/)?.[1]).filter(Boolean));
  const routes=[];
  for(const route of [...new Set(routeNames)]){
   await page.evaluate(route=>navigate(route,null),route);await page.locator('#page-'+route).waitFor();
   assert((await page.locator('#page-'+route).innerText()).trim().length>3,route+' empty route');routes.push(route);
  }
  const picked=await page.evaluate(()=>{const branch=CRMPREVIEW.actor==='barka'?'barka':'muscat';return {client:CRMPREVIEW.db.clients.find(c=>c.lead_route===branch).id,property:CRMPREVIEW.db.properties.find(p=>p.branch_key===branch).id};});
  // The actual rendered form must require outcome and retain input on failure.
  await page.evaluate(id=>viewClient(id),picked.client);await page.locator('#cdTabInfo .info-value bdi').first().waitFor();
  assert.match(await page.locator('#cdTabInfo .info-value bdi').first().innerText(),/^\+968 /);
  assert.equal(await page.locator('#cdTabInfo .info-value bdi').first().evaluate(e=>getComputedStyle(e).direction),'ltr');
  assert(!/[٠-٩۰-۹]/.test(await page.locator('#cdTabInfo .info-row').nth(3).innerText()));
  await page.evaluate(()=>openAddActivity());
  await page.locator('#aType').selectOption('call');await page.locator('#aText').fill('متابعة اصطناعية');
  await page.locator('#mActivity button').filter({hasText:'حفظ'}).click();assert(await page.locator('#mActivity.on').isVisible());
  await page.locator('#aOutcome').fill('لم يرد');await page.locator('#aNextAction').fill('إعادة الاتصال لاحقًا');
  await page.evaluate(()=>CRMPREVIEW.failNext='crm_log_human_activity');await page.locator('#mActivity button').filter({hasText:'حفظ'}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('TEST simulated RPC failure'));
  assert.equal(await page.locator('#aText').inputValue(),'متابعة اصطناعية');
  const first=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_log_human_activity').at(-1));
  await page.locator('#mActivity button').filter({hasText:'حفظ'}).click();await page.waitForFunction(()=>!document.querySelector('#mActivity.on'));
  const last=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_log_human_activity').at(-1));assert.equal(first.args.p_idempotency_key,last.args.p_idempotency_key);
  assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.filter(a=>a.type==='call').length),1);
  // Verify complete client pagination in the deal selector at >1000 records.
  if(role==='owner')await page.evaluate(()=>{const c=CRMPREVIEW.db.clients.find(c=>c.lead_route==='muscat');for(let i=0;i<1205;i++)CRMPREVIEW.db.clients.push({...c,id:'SYNTHETIC-AUDIT-'+i,name:'عميل اصطناعي '+i});});
  await page.evaluate(()=>openModal('mDeal'));await page.locator('#dealWorkflowForm').waitFor();
  if(role==='owner')assert((await page.locator('#dwClientChoice option').count())>1205,'client selector truncated at API page size');
  await page.locator('#dwStage').selectOption('deposit');await page.locator('#dwClientChoice').selectOption(picked.client);await page.locator('#dwPropertyChoice').selectOption(picked.property);
  assert.equal(await page.locator('#dwConfirmPaid').isChecked(),true);assert.equal(await page.locator('#dwConfirmPaid').isDisabled(),true);
  await page.locator('#dwPaidDate').fill('2024-10-31');await page.locator('#dwPaidAmount').fill('500.005');
  const booking=await page.evaluate(()=>crmDealWorkflow.buildPayload());assert.equal(booking.deal.reservation.amount,500.005);assert.equal(booking.deal.reservation.confirm_paid,true);
  await page.evaluate(()=>closeModal('mDeal',true));
  const booked=await page.evaluate(p=>{
   const id='SYNTHETIC-BOOKED-'+CRMPREVIEW.actor;CRMPREVIEW.db.deals.push({id,company_id:CRMPREVIEW.profile.company_id,client_id:p.client,property_id:p.property,agent_id:CRMPREVIEW.actor==='owner'?CRMPREVIEW.db.profiles.find(p=>p.role==='agent').id:CRMPREVIEW.profile.id,stage:'deposit',updated_at:new Date().toISOString(),entry_mode:'historical',reservation_confirmed_at:'2024-10-31T08:00:00Z',deposit_amount:500.005,reservation_evidence_note:'paid_deposit_confirmed_in_crm',reservation_cancelled_at:'2024-11-05T08:00:00Z',reservation_cancellation_reason:'طلب العميل',expected_company_commission_at_reservation:2000});return id;
  },picked);
  await page.evaluate(id=>editDeal(id),booked);await page.locator('#dealWorkflowForm').waitFor();
  assert.equal(await page.locator('#dwPaidDate').getAttribute('readonly'),'');
  if(role==='owner'){
   await page.getByText('تصحيح الحجز أو إعادة تفعيله',{exact:true}).click();
   await page.locator('#dwCorrectionDate').fill('2024-09-30');await page.locator('#dwCorrectionReason').fill('تصحيح موثق اصطناعي');await page.locator('#dwReactivate').check();
   const correction=await page.evaluate(()=>crmDealWorkflow.buildPayload());assert.equal(correction.deal.reservation.correct_paid_on,'2024-09-30');assert.equal(correction.deal.reservation.reactivate,true);assert.equal(correction.deal.reservation.confirm_paid,undefined);
  }else assert.equal(await page.locator('#dwCorrectionDate,#dwReactivate,#dwReceiptSection').count(),0);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,role+'-booking.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' mobile overflow');
  await page.evaluate(()=>closeModal('mDeal',true));
  if(role==='owner'){
   await page.evaluate(()=>navigate('team',null));await page.waitForFunction(()=>document.querySelector('[data-branch-goal-save]'));
   const id=await page.locator('[data-branch-goal-save]').first().getAttribute('data-branch-goal-save');
   await page.locator('#etDaily_'+id).fill('13');await page.locator('[data-branch-goal-save="'+id+'"]').click();
   await page.waitForFunction(id=>document.querySelector('#etDaily_'+id)?.value==='13'&&CRMPREVIEW.db.branch_monthly_targets?.some(x=>x.branch_key===id&&x.daily_followups_target===13),id);
   await page.evaluate(()=>navigate('dash',null));await page.waitForFunction(()=>document.querySelector('#opsEmployeeTargets').textContent.includes('13'));
  }
  report.roles.push({role,routes,checks:['outcome validation','activity failure retains inputs','same key retry','acknowledged save','deposit stage confirms in one payload','three decimals','owner-only corrections','mobile width',...(role==='owner'?['1205+ deal selector','saved target drives dashboard']:[])]});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
