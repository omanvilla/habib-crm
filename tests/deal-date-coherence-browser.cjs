'use strict';
// Synthetic UI/payload evidence only. Atomic persistence and RLS run in PostgreSQL CI.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/deal-date-coherence');fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4197,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],roles:[]};
 try{
  for(const role of ['barka','muscat','owner']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();report.externalRequests.push(new URL(r.request().url()).origin);return r.abort();});page.on('pageerror',e=>report.errors.push(role+': '+e.message));
   await page.goto('http://127.0.0.1:4197/after/'+role+'/');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();await page.locator('#instantLoader').waitFor({state:'hidden'});
   const id=await page.evaluate(()=>{
    const branch=CRMPREVIEW.actor==='barka'?'barka':'muscat',client=CRMPREVIEW.db.clients.find(c=>c.lead_route===branch),property=CRMPREVIEW.db.properties.find(p=>p.branch_key===branch),agent=CRMPREVIEW.db.company_lead_routes.find(r=>r.route_key===branch).assigned_to;
    const viewing={id:'SYNTHETIC-DATE-VISIT',company_id:client.company_id,client_id:client.id,property_id:property.id,agent_id:agent,viewing_date:'2025-08-25',status:'done',archived:false,created_at:'2025-09-16T08:00:00Z'};
    CRMPREVIEW.db.viewings.push(viewing);const d={id:'SYNTHETIC-DATE-DEAL',company_id:client.company_id,client_id:client.id,property_id:property.id,agent_id:agent,viewing_id:viewing.id,stage:'commission_collected',entry_mode:'historical',closed_at:'2025-10-03T08:00:00Z',created_at:'2025-09-16T08:00:00Z',updated_at:'2025-10-07T08:00:00Z',reservation_confirmed_at:null,reservation_cancelled_at:null,deposit_amount:null,commission_total:2500,agent_share:500,company_share:2000,commission_status:'received',commission_received_at:'2025-10-07T08:00:00Z',receipts:[]};CRMPREVIEW.db.deals.push(d);return d.id;
   });
   await page.evaluate(()=>navigate('deals',null));await page.locator('[data-deal-id="'+id+'"]').waitFor();
   const card=page.locator('[data-deal-id="'+id+'"]');assert.match(await card.locator('.crm-deal-dates').innerText(),/حجز: غير مسجل/);assert.match(await card.innerText(),/بيع: 2025-10-03/);assert(!await card.innerText().then(x=>x.includes('حجز: 2025-09-16')));
   await card.click();await page.locator('#dwSavedDates [data-deal-date="visit"] strong').filter({hasText:'2025-08-25'}).waitFor();assert.match(await page.locator('#dwMissingBooking').innerText(),/لم يُنسب إلى هدف حجوزات أي شهر/);assert.equal(await page.locator('#dwPaidDate').inputValue(),'');assert.equal(await page.locator('#dwPaidAmount').inputValue(),'');
   assert.equal(await page.locator('#dwSavedDates [data-deal-date="booking"] strong').innerText(),'غير مسجل');assert.equal(await page.locator('#dwSavedDates [data-deal-date="sale"] strong').innerText(),'2025-10-03');
   if(role==='owner')assert.equal(await page.locator('#dwSavedDates [data-deal-date="receipt"] strong').innerText(),'2025-10-07');else assert.equal(await page.locator('#dwSavedDates [data-deal-date="receipt"],#dwFinanceSection').count(),0);
   checks.push('pipeline and saved-date summary distinguish known visit/sale/receipt from unknown paid booking without using record-creation date','staff view omits collection date and financial controls');
   const untouched=await page.evaluate(()=>crmDealWorkflow.buildPayload());assert.equal(untouched.deal.reservation,undefined);assert.equal(untouched.deal.financials,undefined);
   await page.locator('[data-dw-booking]').click();await page.locator('#dwConfirmPaid').check();await page.locator('#dwPaidDate').fill('2025-10-04');await page.locator('#dwPaidAmount').fill('500.005');
   assert.match(await page.evaluate(()=>{try{crmDealWorkflow.buildPayload();return '';}catch(e){return e.message;}}),/بعد تاريخ البيع/);
   await page.locator('#dwPaidDate').fill('2025-09-30');if(role==='owner')await page.locator('#dwExpectedBookingCommission').fill('2500');
   const payload=await page.evaluate(()=>crmDealWorkflow.buildPayload());assert.equal(payload.deal.id,id);assert.equal(payload.deal.stage,'commission_collected');assert.equal(payload.deal.reservation.paid_on,'2025-09-30');assert.equal(payload.deal.reservation.amount,500.005);assert.equal(payload.deal.closed_on,'2025-10-03');assert.equal(payload.deal.financials?.commission_total,undefined);assert.equal(payload.deal.receipt,undefined);
   await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_deal_workflow');await page.locator('#dwSave').click();await page.locator('#dwError').filter({hasText:'لم تُحفظ'}).waitFor();const first=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_save_deal_workflow').at(-1));
   await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_deal_workflow');await page.locator('#dwSave').click();await page.waitForFunction(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_save_deal_workflow').length===2);const second=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.rpc==='crm_save_deal_workflow').at(-1));assert.equal(second.args.p_idempotency_key,first.args.p_idempotency_key);assert.equal(await page.locator('#dwPaidDate').inputValue(),'2025-09-30');
   checks.push('known manual booking updates the original completed deal and preserves sale/receipt/employee financial values; impossible post-sale booking rejected','failed saves retain date, milli-OMR amount and same retry operation key');
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.locator('#mDeal .dw-modal').screenshot({path:path.join(out,role+'-manual-booking.png'),animations:'disabled'});checks.push('saved-date summary and existing guarded booking form fit390px');
   await page.evaluate(()=>closeModal('mDeal',true));await page.setViewportSize({width:1440,height:1000});
   await page.evaluate(id=>{const d=CRMPREVIEW.db.deals.find(d=>d.id===id);Object.assign(d,{reservation_confirmed_at:'2025-09-30T20:30:00Z',reservation_cancelled_at:'2025-11-01T08:00:00Z',deposit_amount:500.005});return loadDeals();},id);
   assert.match(await page.locator('[data-deal-id="'+id+'"] .crm-deal-dates').innerText(),/2025-10-01/);
   await page.locator('#viewTable').click();assert.match(await page.locator('#dealsContent tr').filter({hasText:'2025-10-01'}).innerText(),/2025-10-03.*2025-11-01/s);
   const client=await page.evaluate(id=>CRMPREVIEW.db.deals.find(d=>d.id===id).client_id,id);await page.evaluate(id=>viewClient(id),client);await page.waitForFunction(()=>document.querySelector('#cdTabDeals .crm-deal-dates')?.textContent.includes('2025-10-01'));await page.evaluate(()=>switchClientTab('deals',null));assert.match(await page.locator('#cdTabDeals').innerText(),/2025-10-01.*2025-10-03/s);checks.push('pipeline/table/client deal tab share exact Oman booking/sale/cancellation dates after reread');
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.checkCount=report.roles.reduce((s,r)=>s+r.checks.length,0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
