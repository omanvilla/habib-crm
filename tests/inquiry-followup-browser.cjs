'use strict';
// Full UI with isolated synthetic SDK responses. SQL29 authorization/atomicity
// and real metric calculations are separately tested by the PostgreSQL fixture.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/inquiry-followup');
fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,realEmployeeSessions:false,externalRequests:[],errors:[],roles:[]};
(async()=>{
 await new Promise(resolve=>server.listen(4197,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  for(const role of ['owner','barka','muscat']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();report.externalRequests.push(url.origin);return route.abort();});
   page.on('pageerror',error=>report.errors.push(role+': '+error.message));
   await page.clock.install({time:new Date('2026-10-19T08:00:00Z')});
   await page.goto('http://127.0.0.1:4197/after/'+role+'/');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();await page.locator('#instantLoader').waitFor({state:'hidden'});
   const seed=await page.evaluate(()=>{
    const db=CRMPREVIEW.db,branch=CRMPREVIEW.actor==='muscat'?'muscat':'barka',client=db.clients.find(c=>c.lead_route===branch),property=db.properties.find(p=>p.branch_key===branch&&p.status==='available'),request=db.client_requests.find(r=>r.client_id===client.id);
    let inquiry=db.property_inquiries.find(q=>q.client_id===client.id&&q.property_id===property.id&&q.request_id===request?.id);
    if(!inquiry){inquiry={id:'00000000-0000-4000-8000-000000029730',company_id:client.company_id,client_id:client.id,property_id:property.id,request_id:request?.id||null,assigned_to:client.assigned_to,source:'other',has_inbound_inquiry:true,inquiry_count:1};db.property_inquiries.push(inquiry);}
    Object.assign(inquiry,{status:'followup',first_inquiry_at:'2026-08-25T08:00:00Z',last_inquiry_at:'2026-09-01T08:00:00Z',last_contact_at:'2026-09-15T08:00:00Z',followup_note:'نتيجة سابقة اصطناعية <img onerror=alert(1)>',next_followup:'2026-10-20',updated_at:'2026-10-19T07:00:00Z'});
    db.activities=[];window.followupTest={calls:[],saved:new Map(),fail:false,pending:false};window.followupOriginalRpc=supa.rpc;
    const countFor=employee=>new Set(db.activities.filter(a=>a.actor_type==='human'&&a.type==='followup'&&a.outcome&&db.clients.find(c=>c.id===a.client_id)?.lead_route===employee.branch).map(a=>a.client_id)).size;
    supa.rpc=async function(name,args){
     if(name==='crm_save_inquiry_followup'){
      const t=window.followupTest,p=args.p_payload,q=db.property_inquiries.find(q=>q.id===p.inquiry_id);t.calls.push(structuredClone(args));
      if(t.pending)await new Promise(resolve=>t.release=resolve);
      if(t.fail){t.fail=false;return {data:null,error:{message:'TEST simulated transport failure'}};}
      if(p.status==='reserved'&&q.status!=='reserved')return {data:null,error:{message:'inquiry_requires_paid_reservation_workflow'}};
      if(t.saved.has(args.p_idempotency_key))return {data:{...structuredClone(t.saved.get(args.p_idempotency_key)),replayed:true},error:null};
      const when=new Date().toISOString();Object.assign(q,{status:p.status,next_followup:p.next_followup,followup_note:p.outcome||q.followup_note,updated_at:when});
      if(p.outcome)q.last_contact_at=when;
      db.activities.push({id:args.p_idempotency_key,company_id:q.company_id,user_id:currentUser.id,client_id:q.client_id,property_id:q.property_id,request_id:q.request_id,type:p.outcome?'followup':'system',activity_type:p.outcome?'followup':'system',activity_text:p.outcome||'تحديث إداري اصطناعي',outcome:p.outcome,actor_type:'human',channel:p.outcome?'manual':'system',occurred_at:when,created_at:when});
      const result={ok:true,inquiry_id:q.id,activity_id:args.p_idempotency_key,contact_recorded:!!p.outcome,inquiry:structuredClone(q),replayed:false};t.saved.set(args.p_idempotency_key,result);return {data:result,error:null};
     }
     const result=await followupOriginalRpc.call(this,name,args);
     if(name==='crm_branch_target_snapshot'&&!result.error)for(const e of result.data.branches)e.followups=countFor(e);
     if(name==='crm_branch_performance'&&!result.error)for(const e of result.data.branches)e.followup_clients=countFor(e);
     return result;
    };
    return {id:inquiry.id,employee:client.assigned_to,branch};
   });
   await page.evaluate(()=>navigate('deals',null));await page.locator('#viewInquiryPipeline').click();
   const card=page.locator('[onclick="openInquiryFollowup(\''+seed.id+'\')"]');await card.waitFor();await card.click();await page.locator('#mInquiryFollowup.on').waitFor();
   assert.equal(await page.locator('#ifNote').inputValue(),'');assert.equal(await page.locator('#ifSummary img').count(),0);assert.match(await page.locator('#ifSummary').innerText(),/الملاحظة السابقة/);
   assert.match(await page.locator('#ifSummary').innerText(),/آخر استفسار.*2026.*آخر متابعة/s);checks.push('actual follow-up button opens separate prior evidence and empty new outcome with safe text rendering');
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.locator('#mInquiryFollowup .modal-box').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   await page.locator('#ifNextAction').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,role+'-mobile.png'),fullPage:true,animations:'disabled'});checks.push('Arabic follow-up form remains usable at390px with visible next action and save controls');
   await page.setViewportSize({width:1440,height:1000});await page.locator('#ifNote').fill('لم يرد، سأحاول غداً — اختبار معزول');await page.locator('#ifNextAction').fill('إعادة الاتصال غداً');
   await page.evaluate(()=>{followupTest.fail=true;});await page.locator('#mInquiryFollowup button.btn-primary').click();await page.waitForFunction(()=>!crmSavingForms.has('mInquiryFollowup'));
   assert.equal(await page.locator('#mInquiryFollowup.on').count(),1);assert.match(await page.locator('#ifNote').inputValue(),/لم يرد/);assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.length),0);
   await page.evaluate(()=>{followupTest.pending=true;});await page.locator('#mInquiryFollowup button.btn-primary').click();await page.waitForFunction(()=>typeof followupTest.release==='function');
   await page.evaluate(()=>saveInquiryFollowup());assert.equal(await page.evaluate(()=>followupTest.calls.length),2);assert(await page.locator('#mInquiryFollowup button.btn-primary').isDisabled());
   await page.evaluate(()=>{followupTest.pending=false;followupTest.release();});await page.locator('#mInquiryFollowup.on').waitFor({state:'hidden'});
   assert(await page.evaluate(()=>JSON.stringify(followupTest.calls[0])===JSON.stringify(followupTest.calls[1])));assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.filter(a=>a.type==='followup').length),1);
   assert.deepEqual(await page.evaluate(id=>{const q=CRMPREVIEW.db.property_inquiries.find(q=>q.id===id);return [q.first_inquiry_at,q.last_inquiry_at];},seed.id),['2026-08-25T08:00:00Z','2026-09-01T08:00:00Z']);
   checks.push('failed save retains inputs, retry retains operation key, double click sends one in-flight request','acknowledged outcome preserves original inbound dates and records one synthetic contact event');
   await page.evaluate(()=>navigate('dash',null));await page.waitForFunction(id=>document.querySelector('[data-target-branch="'+id+'"]')?.closest('.ops-person')?.querySelector('[data-target-go="daily"] strong')?.textContent==='1 / 10',seed.branch);
   checks.push('the refreshed target card displays the linked synthetic unique-client result');
   await page.evaluate(()=>navigate('deals',null));await page.locator('#viewInquiryPipeline').click();await card.click();await page.locator('#mInquiryFollowup.on').waitFor();assert.equal(await page.locator('#ifNote').inputValue(),'');
   await page.locator('#ifNextFollowup').fill('2026-10-21');await page.locator('#mInquiryFollowup button.btn-primary').click();await page.locator('#mInquiryFollowup.on').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.filter(a=>a.type==='followup').length),1);assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.filter(a=>a.type==='system').length),1);checks.push('reopening never pre-fills a fresh result; date-only update adds audit without contact credit');
   await card.click();await page.locator('#mInquiryFollowup.on').waitFor();await page.locator('#ifStatus').selectOption('reserved');await page.locator('#ifNote').fill('مدخلات محفوظة لحين تسجيل العربون');
   assert.match(await page.locator('#ifWorkflowHint').innerText(),/العربون/);await page.locator('#mInquiryFollowup button.btn-primary').click();await page.waitForFunction(()=>!crmSavingForms.has('mInquiryFollowup'));
   assert.equal(await page.locator('#mInquiryFollowup.on').count(),1);assert.equal(await page.locator('#ifNote').inputValue(),'مدخلات محفوظة لحين تسجيل العربون');assert.equal(await page.evaluate(()=>CRMPREVIEW.db.activities.length),2);
   checks.push('an unsupported reservation shows its authoritative workflow instruction and keeps input without false success');
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.checks=report.roles.reduce((sum,r)=>sum+r.checks.length,0);report.pass=true;
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,checks:report.checks,roles:report.roles.map(r=>({role:r.role,checks:r.checks.length})),externalRequests:0,pageErrors:0}));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
