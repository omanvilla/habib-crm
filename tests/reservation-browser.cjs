'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/reservations');fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4189,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,realEmployeeSessions:false,checks:[],errors:[]};
 try{
  for(const role of ['owner','barka','muscat']){
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
   await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   page.on('pageerror',e=>report.errors.push(role+': '+e.message));
   await page.goto('http://127.0.0.1:4189/after/'+role+'/');await page.locator('#loaderScreen').waitFor({state:'hidden'});
   await page.evaluate(()=>openModal('mDeal'));await page.locator('#dealWorkflowForm').waitFor();
   await page.locator('#dwStage').selectOption('negotiation');
   await page.locator('#dwClientChoice').selectOption('__new__');await page.locator('#dwClientName').fill('عميل حجز اصطناعي');await page.locator('#dwClientPhone').fill('+96800000881');
   await page.locator('#dwPropertyChoice').selectOption('__new__');await page.locator('#dwPropertyTitle').fill('عقار حجز اصطناعي');await page.locator('#dwPropertyArea').fill('منطقة اصطناعية');await page.locator('#dwPropertyPrice').fill('80000');await page.locator('#dwPropertyBranch').selectOption(role==='barka'?'barka':'muscat');
   await page.locator('#dwPropertyType').selectOption('villa');
   await page.locator('#dwConfirmPaid').check();await page.locator('#dwPaidDate').fill('2025-10-31');await page.locator('#dwPaidAmount').fill('500');
   if(role==='owner')await page.locator('#dwExpectedBookingCommission').fill('4500');
   else assert.equal(await page.locator('#dwExpectedBookingCommission,#dwReceiptSection').count(),0);
   const payload=await page.evaluate(()=>crmDealWorkflow.buildPayload());
   assert.deepEqual(payload.deal.reservation,{confirm_paid:true,paid_on:'2025-10-31',amount:500,expected_company_commission:role==='owner'?4500:null});
   assert.equal(payload.deal.closed_on,null);assert.equal(payload.deal.receipt,undefined);
   assert.match(await page.locator('#dwPaidDeposit').innerText(),/لا يلزم رفع مستند/);
   await page.screenshot({path:path.join(out,role+'-new-booking.png'),fullPage:true,animations:'disabled'});
   // Failed saves retain the same operation key and the same one-screen reservation.
   await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_deal_workflow');await page.locator('#dwSave').click();await page.waitForFunction(()=>document.querySelector('#dwError').textContent.includes('TEST simulated RPC failure'));
   const first=await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_save_deal_workflow').at(-1));
   await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_deal_workflow');await page.locator('#dwSave').click();await page.waitForFunction(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_save_deal_workflow').length===2);
   const second=await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.rpc==='crm_save_deal_workflow').at(-1));
   assert.equal(second.args.p_idempotency_key,first.args.p_idempotency_key);assert.deepEqual(second.args.p_payload,first.args.p_payload);
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.some(x=>x.rpc==='crm_confirm_paid_reservation')),false);
   await page.evaluate(()=>closeModal('mDeal',true));
   if(role==='owner'){
    await page.evaluate(()=>{const d=CRMPREVIEW.db.deals[0];Object.assign(d,{reservation_confirmed_at:'2025-10-31T08:00:00Z',reservation_evidence_note:'paid_deposit_confirmed_in_crm',deposit_amount:500,expected_company_commission_at_reservation:4500,reservation_recorded_by_name:'مسجل اصطناعي',reservation_recorded_at:'2025-11-01T08:00:00Z',receipts:[]});return editDeal(d.id);});
    await page.locator('#dealWorkflowForm').waitFor();assert(await page.locator('#dwConfirmPaid').isDisabled());
    assert.match(await page.locator('#dwPaidStatus').innerText(),/2025-10-31/);assert.match(await page.locator('#dwPaidStatus').innerText(),/مسجل اصطناعي/);
    assert.equal(await page.locator('#dwPaidDate').getAttribute('readonly'),'');
    await page.locator('#dwExpectedBookingCommission').fill('4600');
    const edit=await page.evaluate(()=>crmDealWorkflow.buildPayload());
    assert.equal(edit.deal.financials.expected_company_commission,4600);assert.equal(edit.deal.financials.commission_total,undefined,'booking estimate edits preserve legacy commission amounts');
    await page.screenshot({path:path.join(out,'owner-booking-provenance.png'),fullPage:true,animations:'disabled'});
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,role+' mobile overflow');
   report.checks.push(role+': inline paid booking, scoped finance fields, preserved retry key, no second reservation RPC, mobile layout'+(role==='owner'?', immutable original booking and actor/source visible, snapshot edit preserves old commission':''));
   await context.close();
  }
  assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
